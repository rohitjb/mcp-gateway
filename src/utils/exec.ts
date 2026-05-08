import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(nodeExecFile)

export const execFile = async (cmd: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync(cmd, args, { shell: false })
  return stdout.trimEnd()
}
