import { System } from "./system";
import World from "./world";
import type Query from "./query";

class CleanupApeDestroySystem extends System {
  private destroyQuery!: Query;
  public init() {
    this.destroyQuery = this.createQuery({ includeApeDestroy: true })
      .fromAll("ApeDestroy")
      .persist();
  }

  public update() {
    const entities = this.destroyQuery.execute();
    for (const entity of entities) {
      entity.destroy();
    }
  }
}

function setupApeDestroy(world: World) {
  world.registerTags("ApeDestroy");
  world.registerSystem("ApeCleanup", CleanupApeDestroySystem);
}

export default setupApeDestroy;
