# VendorPro AI Assistant (text + voice) - v2

## Architecture
```
backend/assistant/
  core/            Reusable, framework-free engine. Imports NO Django / DRF / vms / VendorPro (enforced by tests).
    engine.py      AssistantEngine(provider, registry, system_prompt, ...)  -> run_turn(message, history)
    tools.py       Param, Tool, ToolRegistry (allowlist + argument validation; handlers never reach providers)
    history.py     sanitize_history()        types.py  ToolCall, ModelResponse, AssistantResult, errors
    providers/gemini.py   The ONLY place with Gemini/Google SDK logic
  vendorpro/       This project's domain layer: read-only ORM tools (tools.py) + system prompt (prompt.py)
  wiring.py        Django glue: settings -> provider + registry + prompt -> engine
  views.py         POST /api/assistant/chat (thin)
frontend/src/assistant/  useAssistant.js (controller, dependency-injected), assistantService.js
frontend/src/components/AssistantPanel.vue
```
### Reusing the core in another project / framework
Copy `assistant/core/`. Provide (1) a provider with `generate(system, turns, tools) -> ModelResponse`
(use `core.providers.gemini.GeminiProvider` or write your own), (2) a `ToolRegistry` of your own `Tool`s,
(3) a system prompt. Then call `AssistantEngine(provider, registry, prompt).run_turn(text, history)` from
FastAPI, Flask, a CLI, etc. A tool can declare `to_action=` to emit client actions (e.g. navigate).

## Endpoint
`POST /api/assistant/chat` `{message<=1000 chars, history:[{role:user|assistant,text}]}` ->
`{success, data:{reply, navigation:{page,path}|null, toolsUsed:[...]}}`; errors `{success:false, code, message}`
(400 invalid_request, 429 rate_limited, 503 missing_api_key/invalid_api_key/invalid_model, 504 timeout,
502 provider_error/bad_request/output_truncated/empty_response/too_many_steps). Throttle: 30 requests/min per IP.

## Tools (read-only, validated server-side, max 25 rows)
describe_data, search_vendors, get_vendor, list_rfqs, get_rfq, list_quotations, list_purchase_orders,
list_invoices (overdue_only), list_inventory_items (low_stock_only), navigate (7 allowlisted pages).
Never returned: bank name/account, IFSC, PAN, GST, address, document URL, notes, terms.

## Environment variables (backend/.env; placeholders only - never commit the real key)
| Variable | Default | Meaning |
|---|---|---|
| GEMINI_API_KEY | (none) | Server-side only |
| GEMINI_MODEL | gemini-2.5-flash | Model id |
| GEMINI_TIMEOUT_SECONDS | 20 | Timeout of ONE Gemini call |
| GEMINI_MAX_OUTPUT_TOKENS | 4096 | Output cap per call (clamped to 256-65536 in the adapter) |
| ASSISTANT_TOTAL_TIMEOUT_SECONDS | 45 | Budget for the whole request across all tool steps |
Frontend (optional `frontend/.env`): `VITE_ASSISTANT_TIMEOUT_MS` (default 75000), `VITE_API_URL`.

## Timeout behaviour and its limits
The deadline is **cooperative, not pre-emptive**. The engine checks it before each model call and will not
start a new call with < 5 s left (returns 504 `timeout`). It cannot interrupt (a) a Gemini call already in
flight - that is bounded only by `GEMINI_TIMEOUT_SECONDS` - or (b) a running database query.
Worst case on the server ~ `ASSISTANT_TOTAL_TIMEOUT_SECONDS - 5 + GEMINI_TIMEOUT_SECONDS` + tool time
(defaults: 45 - 5 + 20 = 60 s). Keep `VITE_ASSISTANT_TIMEOUT_MS` above that (default 75 s), otherwise the
browser can give up while the server is still working. If you raise one value, raise the others.
The Gemini per-call timeout is set on the SDK client (per-request override not used - unverified).

## Navigation safety
Server: only 7 allowlisted pages. Frontend: a path must be in the explicit `ALLOWED_PATHS` list **and** exist
in the router (`canNavigate`). Routes in the router are not automatically allowed.

## Findings / risks (unchanged)
- API is unauthenticated (`AllowAny`, by design). Add auth before exposing publicly.
- Vendor names, emails, phones and amounts are sent to Google when you ask questions; bank/PAN/GST/address are not.
- History comes from the browser and could be forged; the prompt tells the model to re-query tools (instruction, not enforcement).
- Existing serializers embed bank/PAN/GST details; the assistant does not use them.
- `src/main.js` is unused by Quasar CLI (its `./app.css` import is dead code); left unchanged.
- `src/voice/adapters/vendorpro/*.jsx` + `useVendorProActions.js` are unused React files.
- "Low stock" = receivedQty - returnedQty <= threshold (default 10). "Pending" is not defined for RFQs.

## Windows PowerShell: setup and run
```powershell
# --- Backend ---
cd C:\path\to\vendorpro-django\backend
py -3.13 -m venv .venv                      # 3.12 or 3.13 recommended; 3.14 is untested with google-genai
.\.venv\Scripts\Activate.ps1                # if blocked: Set-ExecutionPolicy -Scope Process Bypass
python -m pip install --upgrade pip
pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env                                # set DB_*, DJANGO_SECRET_KEY, GEMINI_API_KEY
python manage.py check
python manage.py test assistant --settings=config.test_settings     # SQLite, no PostgreSQL needed
# python manage.py migrate                  # only when you choose to; this DOES change your database
python manage.py runserver 8000

# --- Frontend (second PowerShell window) ---
cd C:\path\to\vendorpro-django\frontend
npm install
npm test
npm run dev                                 # open http://localhost:9000 (use localhost, not 127.0.0.1)
```
Voice: Chrome or Edge, http://localhost, click the mic and allow the permission prompt (Chrome sends audio
to Google, so internet is required). Firefox has no SpeechRecognition; typing still works.

## End-to-end checklist (mark yourself; none of this was run by the author)
Setup: [ ] pip install ok incl. google-genai  [ ] manage.py check clean  [ ] assistant tests pass locally
[ ] npm run dev compiles  [ ] six existing pages + create/edit/send/select/status flows still work.
Gemini/text: [ ] empty key -> "GEMINI_API_KEY is missing"  [ ] wrong key -> invalid-key message, key not visible in
browser/network/logs  [ ] valid key: "Show me all vendors" matches Vendors page  [ ] "What is vendor 1's bank
account?" refused  [ ] "Delete vendor 1" -> not enabled, vendor still exists  [ ] unknown record -> says not found.
Modules: [ ] vendor search  [ ] "Which RFQs are pending?" asks/clarifies or checks real statuses  [ ] quotations for
RFQ-0001 cheapest first  [ ] pending POs then follow-up "Which vendors are associated with them?"  [ ] overdue
invoices (unpaid/non-cancelled, past due)  [ ] low-stock items  [ ] ambiguous question -> one clarifying question.
Navigation: [ ] "Open the Vendors page", "Navigate to Inventory" work  [ ] "Open the settings page" does nothing.
Speech: [ ] mic prompts permission  [ ] spoken question appears as your message and gets a spoken reply
[ ] stop-speaking works  [ ] voice-reply toggle works  [ ] denied permission -> clear message  [ ] Firefox: mic
disabled with notice  [ ] silence -> "didn't hear anything"  [ ] offline -> network message.
Timeouts/limits: [ ] slow reply (30 s+) leaves UI usable  [ ] >30 requests/min -> rate-limit message
[ ] very broad question -> either answer or clear output_truncated message (raise GEMINI_MAX_OUTPUT_TOKENS).
