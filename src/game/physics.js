// Thin wrapper around Rapier (WASM, bundled): world setup, collider tagging, impact collection.
import RAPIER from '@dimforge/rapier3d-compat';
import { TUNE } from '../config.js';

export { RAPIER };

let ready = null;
export function initPhysics() {
  if (!ready) ready = RAPIER.init();
  return ready;
}

// Collision groups: membership in the high 16 bits, filter in the low 16 bits.
const G = { WORLD: 1, LOAD: 2, LOOSE: 4, CRANE: 8 };
const group = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);
export const GROUPS = {
  world: group(G.WORLD, G.LOAD | G.LOOSE),
  load: group(G.LOAD, G.WORLD | G.LOOSE | G.CRANE),
  loose: group(G.LOOSE, G.WORLD | G.LOAD | G.LOOSE | G.CRANE),
  crane: group(G.CRANE, G.LOAD | G.LOOSE),
};

export const STEP = 1 / 60;

export class Phys {
  constructor() {
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: TUNE.gravity, z: 0 });
    this.world.timestep = STEP;
    this.world.numSolverIterations = 6;
    this.eq = new RAPIER.EventQueue(true);
    this.tags = new Map(); // collider handle -> user data
    this.impacts = []; // filled each step: { a, b, force, ca, cb }
  }

  tag(collider, data) {
    this.tags.set(collider.handle, data);
    return collider;
  }

  dataOf(handle) {
    return this.tags.get(handle);
  }

  removeCollider(collider) {
    if (!collider) return;
    this.tags.delete(collider.handle);
    this.world.removeCollider(collider, true);
  }

  removeBody(body) {
    if (!body) return;
    for (let i = body.numColliders() - 1; i >= 0; i--) this.tags.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  fixedBody(x = 0, y = 0, z = 0) {
    return this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  }

  kinematicBody(x = 0, y = 0, z = 0) {
    return this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
  }

  dynamicBody(x, y, z, { canSleep = true, linDamp = 0.02, angDamp = 0.08, ccd = false } = {}) {
    const d = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(linDamp)
      .setAngularDamping(angDamp)
      .setCanSleep(canSleep)
      .setCcdEnabled(ccd);
    return this.world.createRigidBody(d);
  }

  /** Cuboid collider helper. `o`: {x,y,z, rot, friction, restitution, density, groups, events, body} */
  box(hx, hy, hz, o = {}) {
    let d = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(o.x || 0, o.y || 0, o.z || 0)
      .setFriction(o.friction == null ? 0.75 : o.friction)
      .setRestitution(o.restitution == null ? 0.04 : o.restitution)
      .setCollisionGroups(o.groups == null ? GROUPS.world : o.groups);
    if (o.rot) d = d.setRotation(o.rot);
    if (o.density != null) d = d.setDensity(o.density);
    if (o.events) {
      d = d
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(o.eventThreshold == null ? 30 : o.eventThreshold);
    }
    const c = o.body ? this.world.createCollider(d, o.body) : this.world.createCollider(d);
    if (o.tag) this.tag(c, o.tag);
    return c;
  }

  step() {
    this.impacts.length = 0;
    this.world.step(this.eq);
    this.eq.drainContactForceEvents((ev) => {
      const h1 = ev.collider1();
      const h2 = ev.collider2();
      this.impacts.push({
        h1,
        h2,
        a: this.tags.get(h1),
        b: this.tags.get(h2),
        force: ev.totalForceMagnitude(),
        maxForce: ev.maxForceMagnitude(),
      });
    });
  }

  /** World-space contact point between two colliders (or null). */
  contactPoint(h1, h2) {
    const c1 = this.world.getCollider(h1);
    const c2 = this.world.getCollider(h2);
    if (!c1 || !c2) return null;
    let out = null;
    this.world.contactPair(c1, c2, (manifold) => {
      if (out) return;
      if (manifold.numSolverContacts() > 0) {
        const p = manifold.solverContactPoint(0);
        if (p) out = { x: p.x, y: p.y, z: p.z };
      }
    });
    return out;
  }

  /** First hit of a ray going straight down from (x, y, z). Returns distance or -1. */
  rayDown(x, y, z, maxDist, excludeBody, groups = 0xffffffff) {
    const ray = new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups, undefined, excludeBody);
    if (!hit) return null;
    return { dist: hit.timeOfImpact != null ? hit.timeOfImpact : hit.toi, collider: hit.collider };
  }

  dispose() {
    try {
      this.eq.free();
      this.world.free();
    } catch (e) {}
    this.tags.clear();
  }
}
