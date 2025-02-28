class IdGenerator {
  private gen_num: number = 0;
  private prefix: string = "";
  constructor() {
    this.genPrefix();
  }

  public genPrefix(): void {
    this.prefix = Date.now().toString(32);
  }

  public genId(): string {
    this.gen_num++;
    // istanbul ignore if
    if (this.gen_num === 4294967295) {
      this.gen_num = 0;
      this.genPrefix();
    }
    return this.prefix + this.gen_num;
  }
}

function setIntersection<T>(...sets: Set<T>[]): Set<T> {
  const setSizes = sets.map((set) => set.size),
    smallestSetIndex = setSizes.indexOf(Math.min(...setSizes)),
    smallestSet = sets[smallestSetIndex],
    result = new Set(smallestSet);

  sets.splice(smallestSetIndex, 1);

  smallestSet.forEach((value) => {
    for (let i = 0; i < sets.length; i += 1) {
      if (!sets[i].has(value)) {
        result.delete(value);
        break;
      }
    }
  });

  return result;
}

function setUnion<T>(...sets: (Set<T> | Array<T>)[]): Set<T> {
  const result = new Set<T>();

  sets.forEach((set) => {
    set.forEach((value) => result.add(value));
  });

  return result;
}

export { IdGenerator, setIntersection, setUnion };
