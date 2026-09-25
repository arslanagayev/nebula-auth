import { EventBus } from './events';
import type { AuthErrorCode, AuthView, StrengthScore, TextFieldName } from './types';

export type { AuthErrorCode, AuthView, StrengthScore, TextFieldName } from './types';

export interface CardRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Why a submission failed: an {@link AuthErrorCode}, invalid fields, or an unexpected throw. */
export type AuthFailure = AuthErrorCode | 'invalid-form' | 'unexpected';

/**
 * Every message exchanged between the UI and the 3D scene. The payload types are the
 * contract: the UI never calls into the scene directly and vice versa.
 */
export interface AppEvents {
  /** A text field received focus. */
  'field:focus': { readonly view: AuthView; readonly field: TextFieldName };
  /** A text field lost focus. */
  'field:blur': { readonly view: AuthView; readonly field: TextFieldName };
  /** Strength of the new password being typed; `null` when the field is empty or hidden. */
  'password:strength': { readonly score: StrengthScore | null };
  /** A request was sent to the auth service. */
  'auth:pending': { readonly view: AuthView };
  'auth:success': { readonly view: AuthView; readonly name: string };
  /** The request failed, the form had invalid fields, or the auth call threw. */
  'auth:error': { readonly view: AuthView; readonly code: AuthFailure };
  /** The user left the success screen and is back at an empty form. */
  'auth:reset': { readonly view: AuthView };
  /** The card started flipping to show `view`. */
  'view:flip': { readonly view: AuthView };
  /** The card's anchor moved or resized, in viewport pixels. The scene pins the core to it. */
  'layout:card': CardRect;
  /** Lifecycle of the WebGL layer. */
  'scene:status': { readonly status: 'ready' | 'unavailable' | 'lost' };
}

/** Events that describe current state: remembered by the bus and replayable. */
export const APP_STATE_EVENTS = ['layout:card', 'password:strength', 'scene:status'] as const;

export type AppStateEvent = (typeof APP_STATE_EVENTS)[number];

export type AppBus = EventBus<AppEvents, AppStateEvent>;

export const createAppBus = (): AppBus =>
  new EventBus<AppEvents, AppStateEvent>({ state: APP_STATE_EVENTS });
