import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Remember Me Identifier Persistence", () => {
  let localStorageMock: Record<string, string>;

  beforeEach(() => {
    localStorageMock = {};
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => localStorageMock[key] ?? null,
      setItem: (key: string, val: string) => {
        localStorageMock[key] = val;
      },
      removeItem: (key: string) => {
        delete localStorageMock[key];
      },
      clear: () => {
        localStorageMock = {};
      },
    });
  });

  const saveRememberMe = (enabled: boolean, identifier: string) => {
    if (enabled) {
      localStorage.setItem("sm.remember_login:enabled", "true");
      localStorage.setItem("sm.remember_login:identifier", identifier);
    } else {
      localStorage.setItem("sm.remember_login:enabled", "false");
      localStorage.removeItem("sm.remember_login:identifier");
    }
  };

  const getInitialLoginState = () => {
    const remember = localStorage.getItem("sm.remember_login:enabled") !== "false";
    return {
      rememberMe: remember,
      email: remember ? localStorage.getItem("sm.remember_login:identifier") || "" : "",
    };
  };

  it("persists identifier when remember me is checked", () => {
    saveRememberMe(true, "parthipashok04@gmail.com");
    expect(localStorage.getItem("sm.remember_login:enabled")).toBe("true");
    expect(localStorage.getItem("sm.remember_login:identifier")).toBe("parthipashok04@gmail.com");

    const state = getInitialLoginState();
    expect(state.rememberMe).toBe(true);
    expect(state.email).toBe("parthipashok04@gmail.com");
  });

  it("removes identifier when remember me is unchecked", () => {
    saveRememberMe(true, "parthipashok04@gmail.com");
    saveRememberMe(false, "parthipashok04@gmail.com");
    expect(localStorage.getItem("sm.remember_login:enabled")).toBe("false");
    expect(localStorage.getItem("sm.remember_login:identifier")).toBeNull();

    const state = getInitialLoginState();
    expect(state.rememberMe).toBe(false);
    expect(state.email).toBe("");
  });
});
