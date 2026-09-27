export type Approval = {
  action: string
  appointmentId: number
  status: string
  expectedVersion: number
}

export type AgentSource = {
  title: string
  section: string
  snippet: string
}

export type AgentResponse =
  | { thread_id: string; status: 'completed'; message: string; sources?: AgentSource[] }
  | { thread_id: string; status: 'approval_required'; approval: Approval }

export type AgentThreadMessage = { role: 'user' | 'assistant'; content: string }

export type AgentThreadState =
  | { thread_id: string; status: 'completed'; messages: AgentThreadMessage[]; approval: null }
  | { thread_id: string; status: 'approval_required'; messages: AgentThreadMessage[]; approval: Approval }

export type AgentStreamEvent =
  | { type: 'started'; thread_id: string; message: string }
  | { type: 'tool_started'; thread_id: string; tool: string; message: string }
  | { type: 'tool_completed'; thread_id: string; tool: string; status: number | null; message: string }
  | { type: 'approval_required'; thread_id: string; status: 'approval_required'; message: string; approval: Approval }
  | { type: 'completed'; thread_id: string; status: 'completed'; message: string; sources?: AgentSource[] }
  | { type: 'error'; thread_id: string; message: string }

export type InitialAgentState = {
  threadId: string | null
  approval: Approval | null
  greeting: string
}

export interface AgentClient {
  initialState(): InitialAgentState
  getState(threadId: string): Promise<AgentThreadState>
  chat(message: string, threadId: string | null, onEvent: (event: AgentStreamEvent) => void): Promise<AgentResponse>
  resume(threadId: string, decision: 'approve' | 'reject'): Promise<AgentResponse>
}

const apiBaseUrl = (import.meta.env.VITE_AGENT_API_BASE_URL || '').replace(/\/+$/, '')
const knownEvents = new Set(['started', 'tool_started', 'tool_completed', 'approval_required', 'completed', 'error'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`The Agent API returned an invalid ${key}.`)
  return value
}

function parseSources(value: unknown): AgentSource[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(source => !isRecord(source)
    || typeof source.title !== 'string' || typeof source.section !== 'string' || typeof source.snippet !== 'string')) {
    throw new Error('The Agent API returned invalid sources.')
  }
  return value as AgentSource[]
}

function parseAgentResponse(value: unknown): AgentResponse {
  if (!isRecord(value)) throw new Error('The Agent API returned an invalid response.')
  const thread_id = requiredString(value, 'thread_id')
  if (value.status === 'completed') {
    return { thread_id, status: 'completed', message: requiredString(value, 'message'), sources: parseSources(value.sources) }
  }
  if (value.status === 'approval_required' && isRecord(value.approval)) {
    const { action, appointmentId, status, expectedVersion } = value.approval
    if (typeof action !== 'string' || !Number.isSafeInteger(appointmentId) || typeof status !== 'string'
      || !Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0) {
      throw new Error('The Agent API returned invalid approval details.')
    }
    return { thread_id, status: 'approval_required', approval: { action, appointmentId: appointmentId as number, status, expectedVersion: expectedVersion as number } }
  }
  throw new Error('The Agent API returned an unknown response status.')
}

function parseThreadState(value: unknown): AgentThreadState {
  if (!isRecord(value)) throw new Error('The Agent API returned an invalid conversation state.')
  const thread_id = requiredString(value, 'thread_id')
  if (!Array.isArray(value.messages) || value.messages.some(message => !isRecord(message)
    || (message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string')) {
    throw new Error('The Agent API returned invalid conversation messages.')
  }
  const messages = value.messages as AgentThreadMessage[]
  if (value.status === 'completed' && value.approval === null) {
    return { thread_id, status: 'completed', messages, approval: null }
  }
  if (value.status === 'approval_required') {
    const response = parseAgentResponse({ thread_id, status: value.status, approval: value.approval })
    if (response.status === 'approval_required') {
      return { thread_id, status: 'approval_required', messages, approval: response.approval }
    }
  }
  throw new Error('The Agent API returned an invalid conversation state.')
}

function parseStreamEvent(name: string, value: unknown): AgentStreamEvent | null {
  if (!knownEvents.has(name)) return null
  if (!isRecord(value)) throw new Error('The Agent API returned an invalid event.')
  const thread_id = requiredString(value, 'thread_id')
  if (name === 'started') return { type: name, thread_id, message: requiredString(value, 'message') }
  if (name === 'tool_started') return { type: name, thread_id, tool: requiredString(value, 'tool'), message: requiredString(value, 'message') }
  if (name === 'tool_completed') {
    const status = value.status
    if (status !== null && (typeof status !== 'number' || !Number.isFinite(status))) throw new Error('The Agent API returned an invalid tool status.')
    return { type: name, thread_id, tool: requiredString(value, 'tool'), status, message: requiredString(value, 'message') }
  }
  if (name === 'approval_required') {
    const response = parseAgentResponse({ ...value, thread_id })
    if (response.status !== 'approval_required') throw new Error('The Agent API returned invalid approval details.')
    return { type: name, thread_id, status: name, message: requiredString(value, 'message'), approval: response.approval }
  }
  if (name === 'completed') {
    return { type: name, thread_id, status: name, message: requiredString(value, 'message'), sources: parseSources(value.sources) }
  }
  return { type: 'error', thread_id, message: requiredString(value, 'message') }
}

function friendlyAgentError(message: string): Error {
  if (/未知 thread_id|unknown thread_id/i.test(message)) return new Error('This Agent conversation is no longer available. Start a new conversation and try again.')
  if (/有待审批请求|approval pending/i.test(message)) return new Error('This conversation has an approval waiting. Use its Approval Card to continue.')
  if (/no pending approval/i.test(message)) return new Error('This approval is no longer pending. Start a new conversation to try again.')
  return new Error(message)
}

async function post(url: string, body: object): Promise<AgentResponse> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Cannot reach the Agent API. Check that FastAPI is running.')
  }

  if (!response.ok) {
    throw await responseError(response)
  }
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new Error('The Agent API returned an unreadable response. Please retry.')
  }
  try {
    return parseAgentResponse(value)
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error('The Agent API returned an invalid response.')
  }
}

async function getThreadState(threadId: string): Promise<AgentThreadState> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/agent/${encodeURIComponent(threadId)}/state`, {
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new Error('Cannot reach the Agent API. Check that FastAPI is running.')
  }
  if (response.status === 404) {
    const error = await responseError(response)
    if (error.message === 'Not Found') {
      throw new Error('Conversation recovery is not available from this Agent API yet. Please try again later.')
    }
    throw new Error('This Agent conversation is no longer available. Start a new conversation and try again.')
  }
  if (!response.ok) throw await responseError(response)
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new Error('The Agent API returned an unreadable conversation state. Please retry.')
  }
  return parseThreadState(value)
}

async function responseError(response: Response): Promise<Error> {
  const body = await response.text().catch(() => '')
  let detail: string | undefined
  try {
    detail = (JSON.parse(body) as { detail?: string }).detail
  } catch {
    // Vite proxy errors are plain text/HTML when FastAPI is offline.
  }
  if (detail) return friendlyAgentError(detail)
  if (response.status >= 500) return new Error('Cannot reach the Agent API. Check that FastAPI is running.')
  return new Error(`Agent API returned HTTP ${response.status}.`)
}

async function streamChat(message: string, threadId: string | null, onEvent: (event: AgentStreamEvent) => void): Promise<AgentResponse> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/agent/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ message, thread_id: threadId }),
    })
  } catch {
    throw new Error('Cannot reach the Agent API. Check that FastAPI is running.')
  }

  if (!response.ok) {
    throw await responseError(response)
  }
  if (!response.body) throw new Error('The Agent API did not return a stream.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: AgentResponse | null = null

  function consume(frame: string) {
    const lines = frame.split(/\r?\n/)
    const eventName = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!eventName || !data) return
    let payload: unknown
    try {
      payload = JSON.parse(data) as unknown
    } catch {
      throw new Error('The Agent API sent an invalid event.')
    }
    const event = parseStreamEvent(eventName, payload)
    if (!event) return
    onEvent(event)
    if (event.type === 'error') throw friendlyAgentError(event.message || 'The Agent could not complete the request.')
    if (event.type === 'completed') result = { thread_id: event.thread_id, status: 'completed', message: event.message, sources: event.sources }
    if (event.type === 'approval_required') result = { thread_id: event.thread_id, status: 'approval_required', approval: event.approval }
  }

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch {
        throw new Error('The Agent connection was interrupted before a final response. Please retry.')
      }
      const { done, value } = chunk
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.search(/\r?\n\r?\n/)
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '')
        consume(frame)
        boundary = buffer.search(/\r?\n\r?\n/)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) consume(buffer)
  } catch (cause) {
    if (cause instanceof TypeError) throw new Error('The Agent connection was interrupted before a final response. Please retry.')
    throw cause
  } finally {
    reader.releaseLock()
  }

  if (!result) throw new Error('The Agent stream ended before a final response.')
  return result
}

class HttpAgentClient implements AgentClient {
  initialState(): InitialAgentState {
    return {
      threadId: null,
      approval: null,
      greeting: 'Hi, I’m your PetClinic assistant. Ask me about an appointment or a clinic task.',
    }
  }

  getState(threadId: string): Promise<AgentThreadState> {
    return getThreadState(threadId)
  }

  chat(message: string, threadId: string | null, onEvent: (event: AgentStreamEvent) => void): Promise<AgentResponse> {
    return streamChat(message, threadId, onEvent)
  }

  resume(threadId: string, decision: 'approve' | 'reject'): Promise<AgentResponse> {
    return post(`/agent/${encodeURIComponent(threadId)}/resume`, { decision })
  }
}

// A self-contained UI preview. The component only sees the AgentClient contract.
class MockAgentClient implements AgentClient {
  private readonly demoThreadId = 'preview-appointment-2'

  initialState(): InitialAgentState {
    return {
      threadId: this.demoThreadId,
      approval: {
        action: 'cancel_appointment',
        appointmentId: 2,
        status: 'CONFIRMED',
        expectedVersion: 1,
      },
      greeting: 'I found appointment #2. Review the action below before I continue.',
    }
  }

  async getState(threadId: string): Promise<AgentThreadState> {
    const preview = this.initialState()
    return {
      thread_id: threadId,
      status: 'approval_required',
      messages: [],
      approval: preview.approval!,
    }
  }

  async chat(message: string, threadId: string | null, onEvent: (event: AgentStreamEvent) => void): Promise<AgentResponse> {
    onEvent({ type: 'started', thread_id: threadId || this.demoThreadId, message: '正在处理...' })
    await delay(650)
    const match = message.match(/(?:cancel\s*(?:appointment\s*)?#?|取消预约\s*)(\d+)/i)
    if (match) {
      const response: AgentResponse = {
        thread_id: threadId || this.demoThreadId,
        status: 'approval_required',
        approval: {
          action: 'cancel_appointment',
          appointmentId: Number(match[1]),
          status: 'CONFIRMED',
          expectedVersion: 1,
        },
      }
      onEvent({ ...response, type: 'approval_required', message: '等待人工审批...' })
      return response
    }
    const response: AgentResponse = {
      thread_id: threadId || this.demoThreadId,
      status: 'completed',
      message: 'This is a local UI preview. Connect the FastAPI Agent to get live PetClinic answers.',
    }
    onEvent({ ...response, type: 'completed' })
    return response
  }

  async resume(threadId: string, decision: 'approve' | 'reject'): Promise<AgentResponse> {
    await delay(650)
    return {
      thread_id: threadId,
      status: 'completed',
      message: decision === 'approve'
        ? 'Preview approved. No appointment was changed.'
        : 'Request rejected. No appointment was changed.',
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

// The live API is the default; the preview adapter is opt-in.
export const isMockMode = import.meta.env.VITE_AGENT_MODE === 'mock'
export const agentClient: AgentClient = isMockMode ? new MockAgentClient() : new HttpAgentClient()
