import * as Util from "./util";
import type World from "./world";
import type Entity from "./entity";
import { IComponentUpdate } from "./types";
const idGen = new Util.IdGenerator();

class Component {
  /**
   * Internal use only.
   * @private
   */
  readonly _meta: {
    key: string;
    updated: number;
    entityId: string | number;
    refs: Set<string>;
    ready: boolean;
    values: Record<string, unknown>;
  } = {
    key: "",
    updated: 0,
    entityId: "",
    refs: new Set(),
    ready: false,
    values: {},
  };
  public declare readonly entity: Entity;
  public declare readonly id: string;
  readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  preInit<T>(initial: T): T {
    return initial;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  init(initial: unknown) {}

  get type() {
    return this.constructor.name;
  }

  get key(): string {
    return this._meta.key;
  }

  set key(value: string) {
    const old = this._meta.key;
    this._meta.key = value;
    if (old) {
      delete this.entity.c[old];
    }
    if (value) {
      this.entity.c[value] = this;
    }
  }

  destroy() {
    this.preDestroy();
    this._meta.values = {};
    for (const ref of this._meta.refs) {
      const [value, prop, sub] = ref.split("||");
      this.world._deleteRef(
        value,
        this._meta.entityId as string,
        this.id,
        prop,
        sub,
        this._meta.key,
        this.type
      );
    }
    this.world._sendChange({
      op: "destroy",
      component: this.id,
      entity: this._meta.entityId,
      type: this.type,
    });
    this.world.componentsById.delete(this.id);
    this.world.componentPool.get(this.type).release(this);
    this.postDestroy();
  }

  preDestroy() {}

  postDestroy() {}

  getObject(withIds = true) {
    const obj: {
      type: string;
      id?: string;
      entity?: string;
      key?: string;
    } = {
      type: this.constructor.name,
    };
    if (withIds) {
      obj.id = this.id;
      obj.entity = this.entity.id;
    }
    let fields =
      (this.constructor as typeof Component).serializeFields ||
      (this.constructor as typeof Component).fields;
    if (
      Array.isArray((this.constructor as typeof Component).skipSerializeFields)
    ) {
      fields = fields.filter((field) => {
        return (
          (this.constructor as typeof Component).skipSerializeFields!.indexOf(
            field
          ) === -1
        );
      });
    }
    for (const field of fields) {
      if (
        //@ts-expect-error :this[field]
        this[field] !== undefined &&
        //@ts-expect-error :this[field]
        this[field] !== null &&
        //@ts-expect-error :this[field]
        typeof this[field].getValue === "function"
      ) {
        //@ts-expect-error :this[field]
        obj[field] = this[field].getValue();
      } else if (
        Object.prototype.hasOwnProperty.call(this._meta.values, field)
      ) {
        //@ts-expect-error :this[field]
        obj[field] = this._meta.values[field];
      } else {
        //@ts-expect-error :this[field]
        obj[field] = this[field];
      }
    }
    if (this._meta.key) {
      obj.key = this._meta.key;
    }
    return obj;
  }

  _setup(entity: Entity, initial: Record<string | number | symbol, unknown>) {
    Object.defineProperty(this, "entity", { value: entity, writable: false });
    Object.defineProperty(this, "id", {
      value: initial?.id || idGen.genId(),
      writable: false,
    });
    this._meta.updated = this.world.currentTick;
    this._meta.entityId = entity.id;
    if (initial.key) {
      this.key = initial.key as string;
    }
    this._meta.values = {};
    this.world.componentsById.set(this.id, this);

    const fields = (this.constructor as typeof Component).fields;
    const primitives = (this.constructor as typeof Component).primitives;
    const factories = (this.constructor as typeof Component).factories;
    // shallow copy of the property defaults
    initial = this.preInit(initial);
    const values = Object.assign({}, primitives, initial);
    for (const field of fields) {
      const value = values[field];
      if (Object.prototype.hasOwnProperty.call(factories, field)) {
        const res = factories[field](this, value, field);
        if (res !== undefined) {
          //@ts-expect-error :this[field]
          this[field] = res;
        }
      } else {
        //@ts-expect-error :this[field]
        this[field] = value;
      }
    }
    this._meta.ready = true;
    // Object.freeze();
    this.init(initial);
    this.world._sendChange({
      op: "add",
      component: this.id,
      entity: this._meta.entityId,
      type: this.type,
    });
  }

  _reset(): void {
    this._meta.key = "";
    this._meta.updated = 0;
    this._meta.entityId = 0;
    this._meta.ready = false;
    this._meta.refs.clear();
    this._meta.values = {};
  }

  update(values?: IComponentUpdate): void {
    if (values) {
      delete values.type;
      Object.assign(this, values);
      if ((this.constructor as typeof Component).changeEvents) {
        const change: {
          op: string;
          props: string[];
          component: string;
          entity: string | number;
          type: string;
        } = {
          op: "change",
          props: [],
          component: this.id,
          entity: this._meta.entityId,
          type: this.type,
        };
        for (const prop in values) {
          change.props.push(prop);
        }
        this.world._sendChange(change);
      }
    }
    this._meta.updated = this.entity.updatedValues = this.world.currentTick;
  }

  _addRef(value: string, prop: string, sub?: string) {
    this._meta.refs.add(`${value}||${prop}||${sub}`);
    this.world._addRef(
      value,
      this._meta.entityId as string,
      this.id,
      prop,
      sub,
      this._meta.key,
      this.type
    );
  }

  _deleteRef(value: string, prop: string, sub?: string) {
    this._meta.refs.delete(`${value}||${prop}||${sub}`);
    this.world._deleteRef(
      value,
      this._meta.entityId as string,
      this.id,
      prop,
      sub,
      this._meta.key,
      this.type
    );
  }

  static properties: Record<string, unknown>;
  static serialize = true;
  static serializeFields: string[] | null = null;
  static skipSerializeFields: string[] | null = null;
  static subbed = false;
  static registered = false;
  static typeName: string;
  //
  static fields: string[];
  static primitives: Record<string, unknown>;
  static factories: Record<
    string,
    (comp: Component, value: unknown, field: string) => unknown
  >;
  static changeEvents: boolean;
}

export default Component;
