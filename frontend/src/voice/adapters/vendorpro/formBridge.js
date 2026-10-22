/**
 * Form bridge (Option A). Plain JS, no React.
 *
 * A page registers a controller for a form it owns; the voice adapter looks it
 * up by name. The controller is the ONLY way voice/text actions touch page state.
 *
 * Controller contract:
 *   getState(): { open: boolean, mode: 'add' | 'edit' | null, blockedBy: string | null }
 *   openAdd():  { opened: boolean, reason?: 'already-open' | 'edit-in-progress' | 'blocked' }
 *   setFields(values): updates allowed form fields (name, company, email, phone, category, address)
 *   getValues(): returns current form field values
 */
export const VENDOR_FORM = 'vendors.vendorForm';

const controllers = new Map();

/** Register a controller. Returns an unregister function that only removes THIS controller. */
export function registerFormController(name, controller) {
  controllers.set(name, controller);
  return () => {
    if (controllers.get(name) === controller) controllers.delete(name);
  };
}

export function getFormController(name) {
  return controllers.get(name) || null;
}