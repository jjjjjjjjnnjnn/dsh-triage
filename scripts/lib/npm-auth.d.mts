export interface ObservedWhoami {
  ok: boolean
  stdout?: string
  stderr?: string
}

export type AuthState = 'logged-in' | 'not-logged-in' | 'could-not-run'

export interface AuthVerdict {
  state: AuthState
  user: string | null
  detail: string
  observed: string
}

export interface NpmInvocation {
  command: string
  args: string[]
}

export function npmInvocation(
  args: string[],
  platform?: string,
  env?: Record<string, string | undefined>,
): NpmInvocation

export function classifyWhoami(observed: ObservedWhoami): AuthVerdict
