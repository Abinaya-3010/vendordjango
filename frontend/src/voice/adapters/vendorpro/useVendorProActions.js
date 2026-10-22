import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createVendorProActions } from './vendorActions.js';

/**
 * Registers the VendorPro actions on a voice assistant instance.
 * react-router's `navigate` identity changes between renders, so the host
 * handed to the framework-independent actions reads it through refs.
 * The path ref is updated in an effect, i.e. after the route has committed.
 */
export function useVendorProActions(assistant) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navigateRef = useRef(navigate);
  const pathRef = useRef(pathname);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!assistant) return undefined;
    const host = {
      navigate: (path) => navigateRef.current(path),
      getPathname: () => pathRef.current,
    };
    const unregisterAll = createVendorProActions(host).map((action) =>
      assistant.registerAction(action)
    );
    return () => unregisterAll.forEach((unregister) => unregister());
  }, [assistant]);
}
