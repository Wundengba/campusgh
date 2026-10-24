import { useEffect, useState } from "react";

export function useIsMobileLayout(breakpoint = 767) {
  const getMatches = () => globalThis.matchMedia?.(`(max-width: ${breakpoint}px)`).matches ?? ((globalThis.innerWidth || 0) <= breakpoint);
  const [isMobile, setIsMobile] = useState(getMatches);

  useEffect(() => {
    const mediaQuery = globalThis.matchMedia?.(`(max-width: ${breakpoint}px)`);
    if (!mediaQuery) {
      setIsMobile(getMatches());
      return undefined;
    }

    const handleChange = (event) => setIsMobile(event.matches);
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [breakpoint]);

  return isMobile;
}