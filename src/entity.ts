import type Component from "./component";
import type {
  ComponentClass,
  IComponentByType,
  IComponentConfig,
  IComponentObject,
  IEntityComponents,
  IEntityConfig,
  IEntityObject,
} from "./types";
import { IdGenerator } from "./util";
import type World from "./world";

const idGen = new IdGenerator();
class Entity {
  private readonly types: IComponentByType = {};
  public readonly c: IEntityComponents = {};
  public declare readonly id: string;
  private readonly tags = new Set<string>();
  private _updatedComponents = 0;
  public get updatedComponents() {
    return this._updatedComponents;
  }
  updatedValues = 0;
  private destroyed = false;
  private ready = false;

  declare readonly world: World;

  _setup(definition: IEntityConfig | IEntityObject): void {
    this.destroyed = false;
    if (definition.id) {
      Object.defineProperty(this, "id", {
        value: definition.id,
        writable: false,
      });
    } else {
      Object.defineProperty(this, "id", {
        value: idGen.genId(),
        writable: false,
      });
    }
    this.world.entities.set(this.id, this);

    this._updatedComponents = this.world.currentTick;

    if (definition.tags) {
      for (const tag of definition.tags) {
        this.addTag(tag);
      }
    }

    if (definition.components) {
      for (const compdef of definition.components) {
        this.addComponent(compdef);
      }
    }

    if (definition.c) {
      const defs = definition.c;
      for (const key of Object.keys(defs)) {
        const comp = {
          ...defs[key],
          key,
        };
        if (!(comp as IComponentConfig).type)
          (comp as IComponentConfig).type = key;
        this.addComponent(comp);
      }
    }
    this.ready = true;
    this.world._entityUpdated(this);
  }

  has(type: string | ComponentClass): boolean {
    if (typeof type !== "string") {
      type = type.name;
    }
    return (
      this.tags.has(type) ||
      Object.prototype.hasOwnProperty.call(this.types, type)
    );
  }

  getOne(type: string): Component | undefined;
  getOne<T extends Component>(type: { new (): T }): T | undefined;
  getOne(type: string | ComponentClass): Component | undefined {
    if (typeof type !== "string") {
      type = type.name;
    }
    let component;
    // istanbul ignore else
    if (this.types[type]) {
      component = [...this.types[type]][0];
    }
    return component;
  }

  getComponents(type: string): Set<Component>;
  getComponents<T extends Component>(type: { new (): T }): Set<T>;
  getComponents(type: string | ComponentClass) {
    if (typeof type !== "string") {
      type = type.name;
    }
    return this.types[type] || new Set();
  }

  addTag(tag: string) {
    // istanbul ignore next
    if (!this.world.tags.has(tag)) {
      throw new Error(`addTag "${tag}" is not registered. Type-O?`);
    }
    this.tags.add(tag);
    this._updatedComponents = this.world.currentTick;
    this.world.entitiesByComponent[tag].add(this.id);
    if (this.ready) {
      this.world._entityUpdated(this);
    }
  }

  removeTag(tag: string) {
    this.tags.delete(tag);
    this._updatedComponents = this.world.currentTick;
    this.world.entitiesByComponent[tag].delete(this.id);
    this.world._entityUpdated(this);
  }

  addComponent(
    properties: IComponentConfig | IComponentObject
  ): Component | undefined {
    const type = properties.type;
    const pool = this.world.componentPool.get(type);
    if (pool === undefined) {
      throw new Error(`Component "${type}" has not been registered.`);
    }
    const comp = pool.get(this, properties);
    if (!this.types[type]) {
      this.types[type] = new Set();
    }
    this.types[type].add(comp);
    this.world._addEntityComponent(type, this);
    this._updatedComponents = this.world.currentTick;
    if (this.ready) {
      this.world._entityUpdated(this);
    }
    return comp;
  }

  removeComponent(component: Component | string): boolean {
    if (typeof component === "string") {
      component = this.c[component];
    }
    if (component === undefined) {
      return false;
    }
    if (component.key) {
      delete this.c[component.key];
    }
    this.types[component.type].delete(component);

    if (this.types[component.type].size === 0) {
      delete this.types[component.type];
    }
    this.world._deleteEntityComponent(component);
    this.world._entityUpdated(this);
    component.destroy();
    return true;
  }

  getObject(componentIds = true): IEntityObject {
    const obj: IEntityObject = {
      id: this.id,
      tags: [...this.tags],
      components: [],
      c: {},
    };
    for (const type of Object.keys(this.types)) {
      for (const comp of this.types[type]) {
        // $lab:coverage:off$
        if (!(comp.constructor as typeof Component).serialize) {
          continue;
        }
        // $lab:coverage:on$
        if (comp.key) {
          obj.c[comp.key] = comp.getObject(componentIds);
        } else {
          obj.components.push(comp.getObject(componentIds));
        }
      }
    }
    return obj;
  }

  destroy() {
    if (this.destroyed) return;
    if (this.world.refs[this.id]) {
      for (const ref of this.world.refs[this.id]) {
        const [entityId, componentId, prop, sub] = ref.split("...");
        const entity = this.world.getEntity(entityId);
        // istanbul ignore next
        if (!entity) continue;
        const component = entity.world.componentsById.get(componentId);
        // istanbul ignore next
        if (!component) continue;
        const path = prop.split(".");

        let target = component;
        let parent = target;
        for (const prop of path) {
          parent = target;
          target = target[prop];
        }
        if (sub === "__set__") {
          target.delete(this);
        } else if (sub === "__obj__") {
          delete parent[path[1]];
        } else {
          parent[prop] = null;
        }
      }
    }
    for (const type of Object.keys(this.types)) {
      for (const component of this.types[type]) {
        this.removeComponent(component);
      }
    }
    this.tags.clear();
    this.world.entities.delete(this.id);
    delete this.world.entityReverse[this.id];
    this.destroyed = true;
    this.ready = false;
    this.world.entityPool.destroy(this);
    this.world._clearIndexes(this);
  }
}

export default Entity;
