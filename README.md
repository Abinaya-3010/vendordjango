# VendorPro – Django + Quasar migration (work in progress)

Original MERN project is not included or modified. This is an **initial migration scaffold**, not yet feature-parity complete.

## Backend
Install PostgreSQL and create an empty `vendorpro` database. In `backend`, create a Python virtual environment, install `requirements.txt`, copy `.env.example` to `.env` and set credentials. Run:

```bash
python manage.py makemigrations vms
python manage.py migrate
python manage.py runserver 8000
```

## Frontend
In `frontend`, run `npm install` and `npm run dev`. Open http://localhost:9000.

## Known gaps
- Frontend uses generic Quasar CRUD pages, **not** faithful conversions of the seven original bespoke React pages.
- Voice framework-independent JS files are copied, but the React voice widget has **not** been ported or mounted in Quasar.
- RFQ vendor selection, quotation comparison, PO generation, invoice printing, and stock workflows need dedicated UI integration.
- No runtime PostgreSQL integration or end-to-end test has been performed.
- Backend keeps nested line items in PostgreSQL JSON columns for rapid initial migration; a normalized relational schema may be desirable later.
- This project deliberately retains unauthenticated MVP API behavior; do not expose it publicly.
