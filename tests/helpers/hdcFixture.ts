import type { HdcPort } from '../../src/main/contracts/ports'

export function fakeHdc(overrides: Partial<HdcPort> = {}): HdcPort {
  const unexpected = async (): Promise<never> => {
    throw new Error('unexpected device operation')
  }
  return {
    listTargets: unexpected,
    queryBundles: unexpected,
    queryForeground: unexpected,
    queryProcesses: unexpected,
    querySockets: unexpected,
    listForwards: unexpected,
    enableDebugging: unexpected,
    createForward: unexpected,
    removeForward: unexpected,
    ...overrides
  }
}
export const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' })
export const failed = (stderr = 'failure') => ({ code: -1, stdout: '', stderr })
