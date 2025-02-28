import type Component from "./component";
import type Entity from "./entity";
import { ComponentClass } from "./types";
import type World from "./world";

class ComponentPool {
  private readonly world: World;
  private readonly type: string;
  private readonly klass: ComponentClass;
  private readonly pool: Component[] = [];
  private targetSize: number;
  private active = 0;

  constructor(world: World, type: string, spinup: number) {
    this.world = world;
    this.type = type;
    this.klass = this.world.componentTypes[this.type];
    this.targetSize = spinup;
    this.spinUp(spinup);
  }

  public get(
    entity: Entity,
    initial: Record<string | number | symbol, unknown>
  ) {
    let comp;
    if (this.pool.length === 0) {
      comp = new this.klass(this.world);
    } else {
      comp = this.pool.pop();
    }
    comp!._setup(entity, initial);
    this.active++;
    return comp;
  }

  public release(comp: Component) {
    comp._reset();
    //comp._meta.entity = null;
    this.pool.push(comp);
    this.active--;
  }

  public cleanup() {
    if (this.pool.length > this.targetSize * 2) {
      const diff = this.pool.length - this.targetSize;
      const chunk = Math.max(Math.min(20, diff), Math.floor(diff / 4));
      for (let i = 0; i < chunk; i++) {
        this.pool.pop();
      }
    }
  }

  public spinUp(count: number) {
    for (let i = 0; i < count; i++) {
      const comp = new this.klass(this.world);
      this.pool.push(comp);
    }
    this.targetSize = Math.max(this.targetSize, this.pool.length);
  }
}

export default ComponentPool;
