import Entity from "./entity";
import * as Util from "./util";
import type World from "./world";
import type { System } from "./system";
import type {
  ComponentClass,
  IQueryConfig,
  IQueryExecuteConfig,
} from "./types";

class Query {
  private readonly query: {
    froms: {
      from: string;
      entity?: Entity;
      entities?: string[];
      type?: string;
      types?: string[];
    }[];
    filters: { filter: string; types: string[] }[];
  } = {
    froms: [],
    filters: [],
  };

  private hasStatic = false;
  private persisted = false;
  private results = new Set<Entity>();
  private executed = false;
  private added = new Set();
  private readonly removed = new Set();

  private declare trackAdded?: boolean;
  private declare trackRemoved?: boolean;

  constructor(
    private readonly world: World,
    private readonly system: System | null,
    init?: IQueryConfig
  ) {
    if (this.world.config.useApeDestroy && !init) {
      this.not("ApeDestroy");
    }

    if (init) {
      this.trackAdded = init.trackAdded || false;
      this.trackRemoved = init.trackRemoved || false;
      // istanbul ignore if
      if ((this.trackAdded || this.trackRemoved) && !this.system) {
        throw new Error(
          "Queries cannot track added or removed when initialized outside of a system"
        );
      }
      if (this.world.config.useApeDestroy && !init.includeApeDestroy) {
        if (init.not) {
          init.not.push("ApeDestroy");
        } else {
          init.not = ["ApeDestroy"];
        }
      }
      if (init.from) {
        this.from(...init.from);
      }
      if (init.reverse) {
        this.fromReverse(init.reverse.entity, init.reverse.type);
      }
      if (init.all) {
        this.fromAll(...init.all);
      }
      if (init.any) {
        this.fromAny(...init.any);
      }
      if (init.not) {
        this.not(...init.not);
      }
      if (init.only) {
        this.only(...init.only);
      }
      if (init.persist) {
        this.persist();
      }
    }
  }

  from(...entities: (Entity | string)[]): Query {
    entities = entities.map((e) => (typeof e !== "string" ? e.id : e));
    this.query.froms.push({
      from: "from",
      entities: entities as string[],
    });
    this.hasStatic = true;
    return this;
  }

  fromReverse<T extends ComponentClass>(
    entity: Entity | string,
    componentName: string | T
  ): Query {
    if (typeof entity === "string") {
      entity = this.world.getEntity(entity)!;
    }
    if (typeof componentName === "function") {
      componentName = componentName.name;
    }
    this.query.froms.push({
      from: "reverse",
      entity,
      type: componentName,
    });
    return this;
  }

  fromAll(...types: (string | ComponentClass)[]): Query {
    const stringTypes = types.map((t) => (typeof t !== "string" ? t.name : t));
    this.query.froms.push({
      from: "all",
      types: stringTypes,
    });
    return this;
  }

  fromAny(...types: (string | ComponentClass)[]): Query {
    const stringTypes = types.map((t) => (typeof t !== "string" ? t.name : t));
    this.query.froms.push({
      from: "any",
      types: stringTypes,
    });
    return this;
  }

  not(...types: (string | ComponentClass)[]): Query {
    const stringTypes = types.map((t) => (typeof t !== "string" ? t.name : t));
    this.query.filters.push({
      filter: "not",
      types: stringTypes,
    });
    return this;
  }

  only(...types: (string | ComponentClass)[]): Query {
    const stringTypes = types.map((t) => (typeof t !== "string" ? t.name : t));
    this.query.filters.push({
      filter: "only",
      types: stringTypes,
    });
    return this;
  }

  update(entity: Entity) {
    let inFrom = false;
    for (const source of this.query.froms) {
      if (source.from === "all") {
        let found = true;
        for (const type of source.types!) {
          if (!entity.has(type)) {
            found = false;
            break;
          }
        }
        if (found) {
          inFrom = true;
          break;
        }
      } else if (source.from === "any") {
        // const potential = [];
        let found = false;
        for (const type of source.types!) {
          if (entity.has(type)) {
            found = true;
            break;
          }
        }
        if (found) {
          inFrom = true;
          break;
        }
      } /* istanbul ignore else */ else if (source.from === "reverse") {
        // istanbul ignore else
        if (
          Object.prototype.hasOwnProperty.call(
            this.world.entityReverse,
            source.entity!.id
          ) &&
          Object.prototype.hasOwnProperty.call(
            this.world.entityReverse[source.entity!.id],
            source.type!
          )
        ) {
          // const keys = new Set(
          //   this.world.entityReverse[source.entity.id][source.type].keys()
          // );
          if (
            new Set(
              this.world.entityReverse[source.entity!.id][source.type!].keys()
            ).has(entity.id)
          ) {
            inFrom = true;
            break;
          }
        }
      }
    }
    if (inFrom) {
      this.results.add(entity);
      this._filter(entity);
      if (this.trackAdded) {
        this.added.add(entity);
      }
    } else {
      this._removeEntity(entity);
    }
  }

  _removeEntity(entity: Entity) {
    if (this.results.has(entity) && this.trackRemoved) {
      this.removed.add(entity);
    }
    this.results.delete(entity);
  }

  persist(trackAdded?: boolean, trackRemoved?: boolean): Query {
    // istanbul ignore if
    if (this.hasStatic) {
      throw new Error("Cannot persist query with static list of entities.");
    }
    // istanbul ignore if
    if (this.query.froms.length === 0) {
      throw new Error(
        "Cannot persist query without entity source (fromAll, fromAny, fromReverse)."
      );
    }

    this.world.queries.push(this);
    if (this.system !== null) {
      this.system.queries.push(this);
    }

    if (typeof trackAdded === "boolean") {
      this.trackAdded = trackAdded;
    }
    if (typeof trackRemoved === "boolean") {
      this.trackRemoved = trackRemoved;
    }
    this.persisted = true;
    return this;
  }

  clearChanges() {
    this.added.clear();
    this.removed.clear();
  }

  refresh() {
    //load in entities using from methods
    let results = new Set<Entity["id"]>();
    for (const source of this.query.froms) {
      // instanbul ignore else
      if (source.from === "from") {
        results = Util.setUnion(results, source.entities!);
      } else if (source.from === "all") {
        if (source.types!.length === 1) {
          // istanbul ignore if
          if (
            !Object.prototype.hasOwnProperty.call(
              this.world.entitiesByComponent,
              source.types![0]
            )
          ) {
            throw new Error(
              `${source.types![0]} is not a registered Component/Tag`
            );
          }
          results = Util.setUnion(
            results,
            this.world.entitiesByComponent[source.types![0]]
          );
        } else {
          const comps = [];
          for (const type of source.types!) {
            const entities = this.world.entitiesByComponent[type];
            // istanbul ignore if
            if (entities === undefined) {
              throw new Error(`${type} is not a registered Component/Tag`);
            }
            comps.push(entities);
          }
          results = Util.setUnion(results, Util.setIntersection(...comps));
        }
      } else if (source.from === "any") {
        const comps = [];
        for (const type of source.types!) {
          const entities = this.world.entitiesByComponent[type];
          // istanbul ignore if
          if (entities === undefined) {
            throw new Error(`${type} is not a registered Component/Tag`);
          }
          comps.push(entities);
        }
        results = Util.setUnion(results, ...comps);
      } /* istanbul ignore else */ else if (source.from === "reverse") {
        // istanbul ignore else
        if (
          this.world.entityReverse[source.entity!.id] &&
          Object.prototype.hasOwnProperty.call(
            this.world.entityReverse[source.entity!.id],
            source.type!
          )
        ) {
          results = Util.setUnion(
            results,
            new Set([
              ...this.world.entityReverse[source.entity!.id][
                source.type!
              ].keys(),
            ])
          );
        }
      }
    }

    this.results = new Set(
      [...results]
        .map((id) => this.world.getEntity(id))
        .filter((entity) => !!entity)
    );

    //filter results
    for (const entity of this.results) {
      this._filter(entity);
    }

    if (this.trackAdded) {
      this.added = new Set(this.results);
    }

    return this;
  }

  _filter(entity: Entity) {
    for (const filter of this.query.filters) {
      if (filter.filter === "not") {
        for (const type of filter.types) {
          if (entity.has(type)) {
            this.results.delete(entity);
            break;
          }
        }
      } /* istanbul ignore else */ else if (filter.filter === "only") {
        let found = false;
        for (const type of filter.types) {
          if (entity.has(type)) {
            found = true;
            break;
          }
        }
        if (!found) {
          this.results.delete(entity);
        }
      }
    }
  }

  execute(filter?: IQueryExecuteConfig): Set<Entity> {
    if (!this.executed) {
      this.refresh();
    }
    this.executed = true;
    // istanbul ignore next
    if (
      filter === undefined ||
      (!Object.prototype.hasOwnProperty.call(filter, "updatedComponents") &&
        !Object.prototype.hasOwnProperty.call(filter, "updatedValues"))
    ) {
      return this.results;
    }
    const output = [];
    for (const entity of this.results) {
      // istanbul ignore next
      if (
        !(
          filter.updatedComponents &&
          entity.updatedComponents < filter.updatedComponents
        ) &&
        !(filter.updatedValues && entity.updatedValues < filter.updatedValues)
      ) {
        output.push(entity);
      }
    }
    return new Set(output);
  }
}

export default Query;
