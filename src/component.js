const ComponentRefs = require('./componentrefs');
const genId = require('./util').genId;

class Component {

  constructor(entity, initial={}, lookup) {

    this._setup(entity, initial, lookup)
  }

  get entity() {

    return this.world.getEntity(this._meta.entityId);
  }

  _setup(entity, initial, lookup) {

    if (!initial.id) this.id = genId();
    if (lookup === '*') lookup = this.id;
    this._meta = {
      lookup,
      updated: this.world.ticks,
      entityId: entity.id,
      refs: new Set(),
      values: {}
    };
    //Object.seal(this._meta);
    this.world.componentsById.set(this.id, this);

    const props = this.constructor.props;
    const values = Object.assign({}, props.primitive, initial);
    for (const field of props.fields) {
      const value = values[field];
      if (props.special.hasOwnProperty(field)) {
        const res = props.special[field](this, value, field);
        if (res !== undefined) {
          this[field] = res;
        }
      } else {
        this[field] = value;
      }
    }
    this.onInit();
    this.world._sendChange({
      op: 'add',
      component: this.id,
      entity: this._meta.entityId,
      type: this.type
    });
  }

  _updated() {
  }

  _reset() {

    this._meta = null;
  }

  getObject(componentIds=true) {

    const props = this.constructor.props;
    const obj = Object.assign({
      entity: this._meta.entityId,
      type: this.type
    }, this._meta.values);
    for (const field of this.constructor.props.fields) {
      if (!obj.hasOwnProperty(field)) {
        obj[field] = this[field].getValue();
      }
    }
    if (componentIds) {
      obj.id = this.id;
    }
    return obj;
  }


  _addRef(value, prop, sub) {

    this._meta.refs.add(`${value}||${prop}||${sub}`);
    this.world._addRef(value, this._meta.entityId, this.id, prop, sub, this._meta.lookup, this.type);
  }

  _deleteRef(value, prop, sub) {

    this._meta.refs.delete(`${value}||${prop}||${sub}`);
    this.world._deleteRef(value, this._meta.entityId, this.id, prop, sub, this._meta.lookup, this.type);
  }

  destroy() {

    this.onDestroy();
    for (const ref of this._meta.refs) {
      const [value, prop, sub] = ref.split('||');
      this.world._deleteRef(value, this._meta.entity.id, this.id, prop, sub, this._meta.lookup, this.type);
    }
    this._meta.refs.clear();
    this.world._sendChange({
      op: 'destroy',
      component: this.id,
      entity: this._meta.entityId,
      type: this.type
    });
    this.world.componentsById.delete(this.id);
    this.world.componentPool[this.type].release(this);
  }
}

module.exports = Component;
