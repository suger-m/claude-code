/**
 * TaskOutput 的接口抽象。
 * ShellCommand 通过此接口与 TaskOutput 交互，
 * 具体的 TaskOutput 实现留在 src/ 中。
 *
 * 这样 packages/shell 不依赖 TaskOutput 的磁盘 I/O 实现
 * (diskOutput, CircularBuffer, fsOperations 等)。
 */
export interface TaskOutputPort {
  /** 唯一任务 ID */
  readonly taskId: string
  /** 输出文件路径 */
  readonly path: string
  /** stdout 是否直接写入文件 fd（bash 模式） */
  readonly stdoutToFile: boolean
  /** getStdout() 后是否文件内容已全部读入 (可删除) */
  readonly outputFileRedundant: boolean
  /** 输出文件总大小 (字节) */
  readonly outputFileSize: number

  // ─── 写入 (pipe mode / hooks) ─────────────────────────────────────
  writeStdout(data: string): void
  writeStderr(data: string): void

  // ─── 读取 ──────────────────────────────────────────────────────────
  getStdout(): Promise<string>
  getStderr(): string

  // ─── 生命周期 ─────────────────────────────────────────────────────
  clear(): void
  spillToDisk(): void
  deleteOutputFile(): Promise<void>
  flush(): Promise<void>
}
