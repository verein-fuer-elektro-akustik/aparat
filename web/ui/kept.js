// What aparat keeps in this browser (localStorage, under aparat.<name>):
// settings, the clipboard, unsaved changes. Storage can be switched off or
// full (private windows): reading then gives null and writing false, nothing
// throws, and the page goes on with what it has.

const key = (name) => `aparat.${name}`;

export const kept = {
  get(name) {
    try {
      return localStorage.getItem(key(name));
    } catch {
      return null;
    }
  },
  set(name, value) {
    try {
      localStorage.setItem(key(name), String(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(name) {
    try {
      localStorage.removeItem(key(name));
      return true;
    } catch {
      return false;
    }
  },
  // json: null when there is none or it does not parse
  getJson(name) {
    try {
      return JSON.parse(this.get(name));
    } catch {
      return null;
    }
  },
  setJson(name, value) {
    return this.set(name, JSON.stringify(value));
  },
};
