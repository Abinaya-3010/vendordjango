import { poll } from '../../core/utils.js';
import { getFormController, VENDOR_FORM } from './formBridge.js';

export const VENDORS_PATH = '/vendors';

export function normalizePath(path) {
  return String(path || '').replace(/\/+$/, '') || '/';
}

const CANCELLED = Object.freeze({ ok: false, cancelled: true, message: '' });
const ok = (message) => ({ ok: true, message });
const fail = (message) => ({ ok: false, message });

/**
 * Make sure the Vendors page is really mounted (path matches AND the page has
 * registered its form controller). Resolves the controller, or null.
 */
async function ensureVendorsPage(host, signal, timeoutMs) {
  if (normalizePath(host.getPathname()) !== VENDORS_PATH) host.navigate(VENDORS_PATH);
  return poll(
    () => normalizePath(host.getPathname()) === VENDORS_PATH && getFormController(VENDOR_FORM),
    { timeoutMs, signal }
  );
}

/**
 * VendorPro-specific actions.
 * @param {{ navigate(path: string): void, getPathname(): string }} host
 */
export function createVendorProActions(host, { timeoutMs = 2000 } = {}) {
  return [
    {
      id: 'vendors.navigate',
      description: 'Go to the Vendors page',
      phrases: [
        'vendors', 'vendor', 'vendor list', 'vendors list', 'vendor listing',
        'all vendors', 'vendor management',
      ],
      handler: async ({ signal }) => {
        const wasThere =
          normalizePath(host.getPathname()) === VENDORS_PATH && !!getFormController(VENDOR_FORM);
        const controller = await ensureVendorsPage(host, signal, timeoutMs);
        if (signal.aborted) return CANCELLED;
        if (!controller) return fail("I couldn't open the Vendors page.");
        return ok(wasThere ? "You're already on the Vendors page." : 'Opening Vendors.');
      },
    },
    {
      id: 'vendors.openAddForm',
      description: 'Open the existing Add Vendor modal on the Vendors page',
      phrases: [
        'add vendor', 'add new vendor', 'new vendor', 'create vendor',
        'create new vendor', 'register vendor', 'register new vendor',
      ],
      handler: async ({ signal }) => {
        const controller = await ensureVendorsPage(host, signal, timeoutMs);
        if (signal.aborted) return CANCELLED;
        if (!controller) return fail("I couldn't open the Vendors page.");

        // Never touch a form that is already open.
        const before = controller.getState();
        if (before.blockedBy) {
          return fail('Please close the vendor details window first.');
        }
        if (before.open) {
          return before.mode === 'add'
            ? ok('The Add Vendor form is already open.')
            : fail('A vendor is being edited. Please finish or close it first.');
        }

        const attempt = controller.openAdd();
        if (!attempt || !attempt.opened) {
          // Refused: decide from the REAL state, not from the refusal reason alone.
          const now = controller.getState();
          if (now.open && now.mode === 'add' && !now.blockedBy) {
            return ok('The Add Vendor form is already open.');
          }
          if (now.open && now.mode === 'edit') {
            return fail('A vendor is being edited. Please finish or close it first.');
          }
          return fail("I couldn't open the Add Vendor form.");
        }

        // VERIFY the modal is actually open in Add mode before claiming success.
        const verified = await poll(
          () => {
            const current = getFormController(VENDOR_FORM);
            const state = current && current.getState();
            return state && state.open && state.mode === 'add' && !state.blockedBy;
          },
          { timeoutMs, signal }
        );
        if (signal.aborted) return CANCELLED;
        return verified
          ? ok('Opening the Add Vendor form.')
          : fail("I couldn't confirm that the Add Vendor form opened.");
      },
    },
  ];
}
