/*
 * @module ecs/ECS
 * @type {class}
 */
import Entity from "./entity";
import Query from "./query";
import ComponentPool from "./component-pool";
import EntityPool from "./entity-pool";
import setupApeDestroy from "./clean-up";
import type { System } from "./system";
import {
  ComponentClass,
  IEntityByType,
  IEntityConfig,
  IEntityObject,
  IQueryConfig,
  IWorldConfig,
} from "./types";
import type Component from "./component";

const componentReserved = new Set([
  "constructor",
  "init",
  "type",
  "key",
  "destroy",
  "preDestroy",
  "postDestroy",
  "getObject",
  "_setup",
  "_reset",
  "update",
  "clone",
  "_meta",
  "_addRef",
  "_deleteRef",
  "prototype",
]);

/**
 * Main library class for registering Components, Systems, Queries,
 * and runnning Systems.
 * Create multiple World instances in order to have multiple collections.
 * @exports World
 */
export default class World {
  private _currentTick = 0;
  get currentTick() {
    return this._currentTick;
  }
  public readonly entities = new Map<string, Entity>();
  private readonly types = {};
  public readonly tags = new Set<string>();
  public readonly entitiesByComponent: IEntityByType = {};
  public readonly componentsById = new Map();
  public readonly entityReverse: Record<
    string,
    Record<string, Map<string, number>>
  > = {};
  private readonly updatedEntities = new Set<Entity>();
  public readonly componentTypes: Record<string, ComponentClass> = {};
  private readonly components = new Map();
  public readonly queries: Query[] = [];
  public readonly subscriptions = new Map();
  private readonly systems = new Map();
  public readonly refs: Record<string, Set<string>> = {};
  public readonly componentPool = new Map();
  private _statCallback: ((str: string) => void) | null = null;
  private _statTicks = 0;
  private _nextStat = 0;
  public readonly entityPool: EntityPool;

  constructor(readonly config: IWorldConfig) {
    this.config = Object.assign(
      {
        trackChanges: true,
        entityPool: 10,
        cleanupPools: true,
        useApeDestroy: false,
      },
      config
    );
    this.entityPool = new EntityPool(this, this.config.entityPool!);
    if (this.config.useApeDestroy) {
      setupApeDestroy(this);
    }
  }

  /**
   * Called in order to increment ecs.currentTick, update indexed queries, and update key.
   * @method module:ECS#tick
   */
  tick() {
    if (this.config.useApeDestroy) {
      this.runSystems("ApeCleanup");
    }
    this._currentTick++;
    this.updateIndexes();
    this.entityPool.release();
    // istanbul ignore else
    if (this.config.cleanupPools) {
      this.entityPool.cleanup();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const [key, pool] of this.componentPool) {
        pool.cleanup();
      }
    }
    if (this._statCallback) {
      this._nextStat += 1;
      if (this._nextStat >= this._statTicks) {
        this._outputStats();
      }
    }
    return this._currentTick;
  }

  getStats() {
    const stats: {
      entity: {
        active: number;
        pooled: number;
        target: number;
      };
      components: {
        [key: string]: {
          active: number;
          pooled: number;
          target: number;
        };
      };
    } = {
      entity: {
        active: this.entities.size,
        pooled: this.entityPool.pool.length,
        target: this.entityPool.targetSize,
      },
      components: {},
    };
    for (const [key, pool] of this.componentPool) {
      stats.components[key] = {
        active: pool.active,
        pooled: pool.pool.length,
        target: pool.targetSize,
      };
    }
    return stats;
  }

  logStats(freq: number, callback?: (str: string) => void): void {
    // istanbul ignore next
    if (callback === undefined) {
      callback = console.log;
    }
    this._statCallback = callback;
    this._statTicks = freq;
    this._nextStat = 0;
  }

  _outputStats() {
    const stats = this.getStats();
    this._nextStat = 0;
    let output = `${this._currentTick}, Entities: ${stats.entity.active} active, ${stats.entity.pooled}/${stats.entity.target} pooled`;
    for (const key of Object.keys(stats.components)) {
      const cstat = stats.components[key];
      output += `\n${this._currentTick}, ${key}: ${cstat.active} active, ${cstat.pooled}/${cstat.target} pooled`;
    }
    this._statCallback!(output);
  }

  _addRef(
    target: string,
    entity: string,
    component: string,
    prop: string,
    sub: string | undefined,
    key: string,
    type: string
  ) {
    if (!this.refs[target]) {
      this.refs[target] = new Set();
    }
    // const eInst = this.getEntity(target);
    if (!Object.prototype.hasOwnProperty.call(this.entityReverse, target)) {
      this.entityReverse[target] = {};
    }
    if (
      !Object.prototype.hasOwnProperty.call(this.entityReverse[target], key)
    ) {
      this.entityReverse[target][key] = new Map();
    }
    const reverse = this.entityReverse[target][key];
    let count = reverse.get(entity);
    /* $lab:coverage:off$ */
    if (count === undefined) {
      count = 0;
    }
    /* $lab:coverage:on$ */
    reverse.set(entity, count + 1);
    this.refs[target].add([entity, component, prop, sub].join("..."));
    this._sendChange({
      op: "addRef",
      component: component,
      type: type,
      property: prop,
      target,
      entity,
    });
  }

  _deleteRef(
    target: string,
    entity: string,
    component: string,
    prop: string,
    sub: string | undefined,
    key: string,
    type: string
  ) {
    const ref = this.entityReverse[target][key];
    let count = ref.get(entity)!;
    count--;
    // istanbul ignore else
    if (count < 1) {
      ref.delete(entity);
    } else {
      ref.set(entity, count);
    }
    if (ref.size === 0) {
      //@ts-expect-error : TODO: check later
      delete ref[key];
    }
    this.refs[target].delete([entity, component, prop, sub].join("..."));
    if (this.refs[target].size === 0) {
      delete this.refs[target];
    }
    this._sendChange({
      op: "deleteRef",
      component,
      type: type,
      target,
      entity,
      property: prop,
    });
  }

  /**
   * @typedef {Object} definition
   * @property {Object} properites
   * @property {function} init
   */

  /**
   * If you're going to use tags, you needs to let the ECS instance know.
   * @method module:ECS#registerTags
   * @param {string[]|string} tags - Array of tags to register, or a single tag.
   * @example
   * ecs.registerTags['Item', 'Blocked']);
   */
  registerTags(...tags: string[]): void {
    for (const tag of tags) {
      // istanbul ignore if
      if (Object.prototype.hasOwnProperty.call(this.entitiesByComponent, tag)) {
        throw new Error(`Cannot register tag "${tag}", name is already taken.`);
      }
      this.entitiesByComponent[tag] = new Set();
      this.tags.add(tag);
    }
  }

  registerComponent<T extends typeof Component>(klass: T, spinup = 1) {
    if (klass.typeName && klass.name !== klass.typeName) {
      Object.defineProperty(klass, "name", { value: klass.typeName });
    }
    const name = klass.name;
    // istanbul ignore if
    if (this.tags.has(name)) {
      throw new Error(`registerComponent: Tag already defined for "${name}"`);
    } /* istanbul ignore if */ else if (
      Object.prototype.hasOwnProperty.call(this.componentTypes, name)
    ) {
      throw new Error(
        `registerComponent: Component already defined for "${name}"`
      );
    }
    this.componentTypes[name] = klass;
    if (!klass.registered) {
      klass.registered = true;
      klass.fields = Object.keys(klass.properties);
      klass.primitives = {};
      klass.factories = {};
      for (const field of klass.fields) {
        // istanbul ignore if
        if (componentReserved.has(field)) {
          throw new Error(
            `Error registering ${klass.name}: Reserved property name "${field}"`
          );
        }
        if (typeof klass.properties[field] === "function") {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
          (klass.factories[field] as Function) = klass.properties[field];
        } else {
          klass.primitives[field] = klass.properties[field];
        }
      }
    }
    this.entitiesByComponent[name] = new Set();
    this.componentPool.set(name, new ComponentPool(this, name, spinup));
  }

  createEntity(definition: IEntityConfig | IEntityObject): Entity {
    return this.entityPool.get(definition);
  }

  getObject() {
    const obj = [];
    for (const kv of this.entities) {
      obj.push(kv[1].getObject());
    }
    return obj;
  }

  createEntities(definitions: IEntityConfig[] | IEntityObject[]) {
    for (const entityDef of definitions) {
      this.createEntity(entityDef);
    }
  }

  copyTypes(world: World, types: string[]) {
    for (const name of types) {
      if (world.tags.has(name)) {
        this.registerTags(name);
      } else {
        const klass = world.componentTypes[name];
        this.componentTypes[name] = klass;
        this.entitiesByComponent[name] = new Set();
        this.componentPool.set(name, new ComponentPool(this, name, 1));
      }
    }
  }

  removeEntity(id: Entity | string): void {
    let entity;
    if (id instanceof Entity) {
      entity = id;
      id = entity.id;
    } else {
      entity = this.getEntity(id);
    }
    entity!.destroy();
  }

  getEntity(entityId: string): Entity | undefined {
    return this.entities.get(entityId);
  }

  getEntities(type: string | ComponentClass): Set<Entity> {
    if (typeof type !== "string") {
      type = type.name;
    }
    const results = [...this.entitiesByComponent[type]];
    return new Set(
      results
        .map((id) => this.getEntity(id))
        .filter((entity): entity is Entity => entity !== undefined)
    );
  }

  getComponent(id: string) {
    return this.componentsById.get(id);
  }

  createQuery(init?: IQueryConfig) {
    return new Query(this, null, init);
  }

  _sendChange(operation: {
    op: string;
    component: string;
    entity: string | number;
    property?: string;
    target?: string;
    type: string;
  }) {
    if ((this.componentTypes[operation.type] as typeof Component).subbed) {
      const systems = this.subscriptions.get(operation.type);
      // istanbul ignore if
      if (!systems) {
        return;
      }
      for (const system of systems) {
        system._recvChange(operation);
      }
    }
  }

  registerSystem<T extends typeof System>(
    group: string,
    system: T | System,
    initParams?: unknown[]
  ): unknown {
    initParams = initParams || [];
    if (typeof system === "function") {
      system = new system(this, ...initParams);
    }
    if (!this.systems.has(group)) {
      this.systems.set(group, new Set());
    }
    this.systems.get(group).add(system);
    return system;
  }

  runSystems(group: string): void {
    const systems = this.systems.get(group);
    if (!systems) return;
    for (const system of systems) {
      system._preUpdate();
      system.update(this._currentTick);
      system._postUpdate();
      system.lastTick = this._currentTick;
      if (system.changes.length !== 0) {
        system.changes = [];
      }
    }
  }

  _entityUpdated(entity: Entity) {
    // istanbul ignore else
    if (this.config.trackChanges) {
      this.updatedEntities.add(entity);
    }
  }

  _addEntityComponent(name: string, entity: Entity) {
    this.entitiesByComponent[name].add(entity.id);
  }

  _deleteEntityComponent(component: Component) {
    //@ts-expect-error: _meta
    this.entitiesByComponent[component.type].delete(component._meta.entityId);
  }

  _clearIndexes(entity: Entity) {
    for (const query of this.queries) {
      query._removeEntity(entity);
    }
    this.updatedEntities.delete(entity);
  }

  updateIndexes() {
    for (const entity of this.updatedEntities) {
      this._updateIndexesEntity(entity);
    }
    this.updatedEntities.clear();
  }

  _updateIndexesEntity(entity: Entity): void {
    for (const query of this.queries) {
      query.update(entity);
    }
  }
}
