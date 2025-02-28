import { IEntityConfig, IEntityObject } from "./types";
import Entity from "./entity";
import type World from "./world";

class EntityPool {
  private readonly world: World;
  readonly pool: Entity[] = [];
  private readonly destroyed: Entity[] = [];
  private readonly worldEntity = class WorldEntity extends Entity {};
  private _targetSize: number;
  public get targetSize() {
    return this._targetSize;
  }

  constructor(world: World, spinup: number) {
    this.world = world;
    this.worldEntity = class WorldEntity extends Entity {};
    //@ts-expect-error : this.worldEntity.prototype.world = this.world
    this.worldEntity.prototype.world = this.world;
    this.spinUp(spinup);
    this._targetSize = spinup;
  }

  public destroy(entity: Entity) {
    this.destroyed.push(entity);
  }

  public get(definition: IEntityConfig | IEntityObject): Entity {
    let entity;
    if (this.pool.length === 0) {
      entity = new this.worldEntity();
    } else {
      entity = this.pool.pop();
    }
    entity!._setup(definition);
    return entity!;
  }

  public release() {
    while (this.destroyed.length > 0) {
      const entity = this.destroyed.pop();
      this.pool.push(entity!);
    }
  }

  public cleanup() {
    if (this.pool.length > this._targetSize * 2) {
      const diff = this.pool.length - this._targetSize;
      const chunk = Math.max(Math.min(20, diff), Math.floor(diff / 4));
      for (let i = 0; i < chunk; i++) {
        this.pool.pop();
      }
    }
  }

  public spinUp(count: number) {
    for (let i = 0; i < count; i++) {
      const entity = new this.worldEntity();
      this.pool.push(entity);
    }
    this._targetSize = Math.max(this._targetSize, this.pool.length);
  }
}

export default EntityPool;
