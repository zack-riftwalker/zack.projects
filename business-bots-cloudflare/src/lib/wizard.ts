import { Composer, type Context, type MiddlewareFn } from 'grammy';

export interface SceneData { id: string; step: number; state: Record<string, any> }
export interface SceneSession { __scene?: SceneData }

export interface SceneControl {
  enter(id: string, initialState?: Record<string, any>): Promise<void>;
  leave(): Promise<void>;
}
export interface WizardControl {
  readonly state: Record<string, any>;
  next(): void;
}
export interface WizardFlavor {
  scene: SceneControl;
  wizard: WizardControl;
}

type StepFn<C> = (ctx: C) => Promise<unknown> | unknown;

/** Telegraf-compatible WizardScene (state lives in the D1 session). */
export class WizardScene<C extends Context> {
  readonly steps: StepFn<C>[];
  readonly composer = new Composer<C>();
  constructor(public readonly id: string, ...steps: StepFn<C>[]) {
    this.steps = steps;
  }
  command(name: string, fn: (ctx: C) => unknown): this {
    this.composer.command(name, async (ctx) => {
      await fn(ctx as C);
    });
    return this;
  }
  hears(re: RegExp | string, fn: (ctx: C) => unknown): this {
    this.composer.hears(re, async (ctx) => {
      await fn(ctx as C);
    });
    return this;
  }
}

/** Safe session accessor: grammY throws when the session key is undefined. */
export function getSessionOf<S>(ctx: Context): (S & SceneSession) | undefined {
  try {
    return (ctx as any).session as S & SceneSession;
  } catch {
    return undefined;
  }
}

export interface StageOptions<C> {
  /** Updates that skip the active scene (it stays active), e.g. buttons on unrelated messages. */
  bypass?: (ctx: C) => boolean;
  /** Updates that close the active scene and then run normally, e.g. /start. */
  exit?: (ctx: C) => boolean;
}

export class Stage<C extends Context & WizardFlavor> {
  private scenes = new Map<string, WizardScene<C>>();
  constructor(scenes: WizardScene<C>[], private opts: StageOptions<C> = {}) {
    for (const s of scenes) this.scenes.set(s.id, s);
  }

  middleware(): MiddlewareFn<C> {
    return async (ctx, next) => {
      const session = getSessionOf<{}>(ctx);

      const runStep = async (scene: WizardScene<C>) => {
        const data = session!.__scene;
        if (!data) return;
        const step = scene.steps[data.step];
        if (!step) {
          delete session!.__scene;
          return;
        }
        await step(ctx);
      };

      ctx.scene = {
        enter: async (id, initialState) => {
          const scene = this.scenes.get(id);
          if (!scene || !session) return;
          session.__scene = { id, step: 0, state: { ...(initialState ?? {}) } };
          await runStep(scene);
        },
        leave: async () => {
          if (session) delete session.__scene;
        },
      };
      ctx.wizard = {
        get state() {
          return session?.__scene?.state ?? {};
        },
        next() {
          if (session?.__scene) session.__scene.step += 1;
        },
      };

      const data = session?.__scene;
      if (!data) return next();
      const scene = this.scenes.get(data.id);
      if (!scene) {
        delete session!.__scene;
        return next();
      }
      if (this.opts.bypass?.(ctx)) return next();
      if (this.opts.exit?.(ctx)) {
        delete session!.__scene;
        return next();
      }

      let fallThrough = false;
      await scene.composer.middleware()(ctx, async () => {
        fallThrough = true;
      });
      if (!fallThrough) return;
      // Otherwise an active scene consumes every update (legacy Telegraf behaviour).
      await runStep(scene);
    };
  }
}
