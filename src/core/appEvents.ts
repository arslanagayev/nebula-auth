import type { AuthErrorCode } from '../lib/authService';
import type { StrengthScore } from '../lib/passwordStrength';
import { EventBus } from './events';

export type AuthView = 'sign-in' | 'register';

export interface CardRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Every message exchanged between the UI and the 3D scene. The payload types are the
 * contract: the UI never calls into the scene directly and vice versa.
 */
export interface AppEvents {
  /** A form control received focus. */
  'field:focus': { readonly view: AuthView; readonly field: string };
  /** A form control lost focus. */
  'field:blur': { readonly view: AuthView; readonly field: string };
  /** Strength of the new password being typed; `null` when the field is empty or hidden. */
  'password:strength': { readonly score: StrengthScore | null };
  /** A request was sent to the auth service. */
  'auth:pending': { readonly view: AuthView };
  'auth:success': { readonly view: AuthView; readonly name: string };
  /** The request failed, or the form was submitted with invalid fields (`invalid-form`). */
  'auth:error': { readonly view: AuthView; readonly code: AuthErrorCode | 'invalid-form' };
  /** The user left the success screen and is back at an empty form. */
  'auth:reset': { readonly view: AuthView };
  /** The card started flipping to show `view`. */
  'view:flip': { readonly view: AuthView };
  /** The card moved or resized, in viewport pixels. The scene anchors the glass core to it. */
  'layout:card': CardRect;
  /** Lifecycle of the WebGL layer. */
  'scene:status': { readonly status: 'ready' | 'unavailable' | 'lost' };
}

export type AppBus = EventBus<AppEvents>;

export const createAppBus = (): AppBus => new EventBus<AppEvents>();
