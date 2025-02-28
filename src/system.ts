import Query from "./query";
import type World from "./world";
import type { ComponentClass, IComponentChange, IQueryConfig } from "./types";
import type Component from "./component";

export class System {
  private readonly world: World;
  private _stagedChanges: IComponentChange[] = [];
  private changes: IComponentChange[] = [];
  readonly queries: Query[] = [];
  private readonly lastTick: number;

  constructor(world: World, ...initArgs: unknown[]) {
    this.world = world;

    this.lastTick = this.world.currentTick;
    if ((this.constructor as typeof System).subscriptions) {
      for (const sub of (this.constructor as typeof System).subscriptions) {
        this.subscribe(sub);
      }
    }
    this.init(...initArgs);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public init(...initArgs: unknown[]): void {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public update(tick: number): void {}

  public createQuery(init?: IQueryConfig): Query {
    return new Query(this.world, this, init);
  }

  public subscribe(type: string | ComponentClass): void {
    if (typeof type !== "string") {
      type = type.name;
    }
    if (!this.world.subscriptions.has(type)) {
      (this.world.componentTypes[type] as typeof Component).subbed = true;
      this.world.subscriptions.set(type, new Set());
    }
    this.world.subscriptions.get(type).add(this);
  }

  _preUpdate() {
    this.changes = this._stagedChanges;
    this._stagedChanges = [];
    this.world.updateIndexes();
  }

  _postUpdate() {
    for (const query of this.queries) {
      query.clearChanges();
    }
  }

  _recvChange(change: IComponentChange) {
    this._stagedChanges.push(change);
  }

  static subscriptions: string[];
}
