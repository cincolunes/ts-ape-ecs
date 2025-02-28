import type Component from "./component";

class _EntitySet extends Set {
  private readonly sub = "__set__";
  private readonly dvalue: string[];
  constructor(
    private readonly component: Component,
    object: unknown[],
    private readonly field: string
  ) {
    super();

    object = object.map((value) =>
      typeof value === "string" ? value : (value as { id: string }).id
    );
    this.dvalue = object as string[];
    for (const item of object as string[]) {
      this.add(item);
    }
  }

  _reset() {
    this.clear();
    for (const item of this.dvalue) {
      this.add(item);
    }
  }

  add(value: { id?: string } | string): this {
    if (typeof value !== "string" && value.id) {
      value = value.id;
    }
    this.component._addRef(value as string, this.field, this.sub);
    return super.add(value);
  }

  delete(value: { id?: string } | string): boolean {
    if (typeof value !== "string" && value.id) {
      value = value.id;
    }
    this.component._deleteRef(value as string, this.field, this.sub);
    const res = super.delete(value);
    return res;
  }

  has(value: { id?: string } | string): boolean {
    if (typeof value !== "string" && value.id) {
      value = value.id;
    }
    return super.has(value);
  }

  [Symbol.iterator]() {
    const siterator = super[Symbol.iterator]();
    const iterator = {
      next: () => {
        const result = siterator.next();
        if (typeof result.value === "string") {
          result.value = this.component.entity.world.getEntity(result.value);
        }
        return result;
      },
      [Symbol.iterator]() {
        return iterator;
      },
    };
    return iterator;
  }

  getValue() {
    return [...this].map((entity) => entity.id);
  }
}

export function EntityRef(comp: Component, dvalue: unknown, field: string) {
  dvalue = dvalue || null;
  if (!Object.prototype.hasOwnProperty.call(comp, field)) {
    Object.defineProperty(comp, field, {
      get() {
        return comp.world.getEntity(comp._meta.values[field] as string);
      },
      set(value) {
        const old = comp._meta.values[field] as string;
        value = value && typeof value !== "string" ? value.id : value;
        if (old && old !== value) {
          comp._deleteRef(old, field, undefined);
        }
        if (value && value !== old) {
          comp._addRef(value, field, undefined);
        }
        comp._meta.values[field] = value;
      },
    });
  }
  //@ts-expect-error: comp[field]
  comp[field] = dvalue;
  return;
}
export function EntityObject(comp: Component, object: unknown, field: string) {
  comp._meta.values[field] = object || {};
  const values = comp._meta.values[field] as Record<string, unknown>;
  const keys = Object.keys(values);
  for (const key of keys) {
    if (values[key] && typeof values[key] === "object" && "id" in values[key]) {
      values[key] = values[key].id;
    }
  }
  return new Proxy(comp._meta.values[field] as object, {
    get(obj, prop) {
      //@ts-expect-error: obj[prop]
      return comp.world.getEntity(obj[prop]);
    },
    set(obj, prop, value) {
      //@ts-expect-error: obj[prop]
      const old = obj[prop];
      if (value && value.id) {
        value = value.id;
      }
      //@ts-expect-error: obj[prop]
      obj[prop] = value;
      if (old && old !== value) {
        //@ts-expect-error: obj[prop]
        comp._deleteRef(old, `${field}.${prop}`, "__obj__");
      }
      if (value && value !== old) {
        //@ts-expect-error: obj[prop]
        comp._addRef(value, `${field}.${prop}`, "__obj__");
      }
      return true;
    },
    deleteProperty(obj, prop) {
      if (!Object.prototype.hasOwnProperty.call(obj, prop)) return false;
      //@ts-expect-error: obj[prop]
      const old = obj[prop];
      //@ts-expect-error: obj[prop]
      delete obj[prop];
      //@ts-expect-error: obj[prop]
      comp._deleteRef(old, `${field}.${prop}`, "__obj__");
      return true;
    },
  });
}
export function EntitySet(
  component: Component,
  object: unknown[],
  field: string
) {
  return new _EntitySet(component, object, field);
}
