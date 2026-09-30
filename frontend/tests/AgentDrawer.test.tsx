import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'

type StreamFrame = { event: string; data: Record<string, unknown> }

const threadId = 'thread-demo-123'
const threadStorageKey = 'petclinic-agent-thread-id'

function streamResponse(...frames: StreamFrame[]): Response {
  const body = frames.map(frame => `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function completed(message: string, extra: Record<string, unknown> = {}): StreamFrame {
  return { event: 'completed', data: { thread_id: threadId, status: 'completed', message, ...extra } }
}

function approvalRequired(): StreamFrame {
  return {
    event: 'approval_required',
    data: {
      thread_id: threadId,
      status: 'approval_required',
      message: '等待人工审批…',
      approval: { action: 'cancel_appointment', appointmentId: 5, status: 'REQUESTED', expectedVersion: 0 },
    },
  }
}

describe('Agent Drawer', () => {
  let container: HTMLDivElement
  let root: Root
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => root.render(<App />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  async function openDrawer() {
    await act(async () => container.querySelector<HTMLButtonElement>('.agent-launcher')!.click())
  }

  async function enterText(text: string) {
    await act(async () => {
      const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message Agent"]')!
      const setter = Object.getOwnPropertyDescriptor(textarea.ownerDocument.defaultView!.HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, text)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function submit() {
    await act(async () => {
      container.querySelector<HTMLFormElement>('.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
  }

  async function waitFor(check: () => boolean) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (check()) return
      await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
    }
    throw new Error('Timed out waiting for the Agent Drawer state.')
  }

  async function ask(text: string) {
    await openDrawer()
    await enterText(text)
    await submit()
  }

  it('opens contextual actions without fetching and restores hotspot focus on Escape', async () => {
    const hotspot = container.querySelector<HTMLButtonElement>('[aria-label^="Cat hotspot:"]')!
    hotspot.focus()
    await act(async () => hotspot.click())
    const panel = container.querySelector<HTMLElement>('.scene-quick-actions')!
    expect(hotspot.getAttribute('aria-expanded')).toBe('true')
    expect(panel.contains(document.activeElement)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(container.querySelector('.scene-quick-actions')).toBeNull()
    expect(document.activeElement).toBe(hotspot)
  })

  it('passes an unbound appointment draft to the Drawer and returns to its hotspot', async () => {
    const hotspot = container.querySelector<HTMLButtonElement>('[aria-label^="Dog hotspot:"]')!
    await act(async () => hotspot.click())
    await act(async () => container.querySelector<HTMLButtonElement>('.scene-quick-actions button')!.click())
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Show appointment ')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.querySelector('.scene-quick-actions')).toBeNull()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })))
    expect(document.activeElement).toBe(hotspot)
    const vetNav = container.querySelector<HTMLButtonElement>('.nav-item[aria-label="Vets"]')!
    await act(async () => vetNav.click())
    expect(vetNav.getAttribute('aria-current')).toBe('page')
    expect(container.querySelector('.section-placeholder h2')?.textContent).toBe('Vets workspace')
  })

  it('contains keyboard focus and returns to the launcher on Escape', async () => {
    await openDrawer()
    const panel = container.querySelector<HTMLElement>('.agent-drawer')!
    const first = container.querySelector<HTMLButtonElement>('[aria-label="New conversation"]')!
    const input = container.querySelector<HTMLTextAreaElement>('textarea')!
    expect(document.activeElement).toBe(input)
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(container.querySelector('.main')?.hasAttribute('inert')).toBe(true)

    first.focus()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })))
    expect(document.activeElement).toBe(input)
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })))
    expect(document.activeElement).toBe(first)

    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })))
    expect(container.querySelector('.agent-drawer')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector('.agent-launcher'))
    expect(container.querySelector('.main')?.hasAttribute('inert')).toBe(false)
  })

  it('keeps an in-flight request when the drawer is closed and reopened', async () => {
    let resolveFetch!: (response: Response) => void
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { resolveFetch = resolve }))
    await ask('Show pet 1')
    expect(container.querySelector('.drawer-status')?.textContent).toContain('Processing request')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close Agent sidebar"]')!.click())
    await openDrawer()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true)
    await act(async () => resolveFetch(streamResponse(completed('Pet query complete.'))))
    await waitFor(() => container.textContent?.includes('Pet query complete.') === true)
    expect(container.querySelector('.drawer-status')?.textContent).toContain('Ready to help')
    expect(container.querySelector<HTMLDetailsElement>('.tool-copy')?.open).toBe(false)
  })

  it('focuses the pending approval and identifies a Reject submission', async () => {
    let resolveResume!: (response: Response) => void
    fetchMock.mockResolvedValueOnce(streamResponse(approvalRequired()))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveResume = resolve }))
    await ask('Cancel appointment 5')
    await waitFor(() => container.querySelector('.approval-card') !== null)
    const reject = container.querySelector<HTMLButtonElement>('.reject-button')!
    expect(document.activeElement).toBe(reject)
    expect(container.querySelector('.drawer-status')?.textContent).toContain('Waiting for your approval')
    await act(async () => reject.click())
    expect(reject.textContent).toBe('Rejecting…')
    expect(container.querySelector('.approve-button')?.textContent).toContain('Approve')
    expect(container.querySelector('.drawer-status')?.textContent).toContain('Submitting rejection')
    await act(async () => resolveResume(new Response(JSON.stringify({ thread_id: threadId, status: 'completed', message: '取消未执行：人工拒绝。' }), { status: 200 })))
    await waitFor(() => container.querySelector('.approval-card') === null)
    expect(document.activeElement).toBe(container.querySelector('textarea'))
  })

  it('preserves a reader scroll position during SSE and follows again near the bottom', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value } }), {
      status: 200, headers: { 'Content-Type': 'text/event-stream' },
    }))
    await ask('Show pet 1')
    const area = container.querySelector<HTMLDivElement>('.conversation')!
    Object.defineProperties(area, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } })
    area.scrollTop = 0
    await act(async () => area.dispatchEvent(new Event('scroll', { bubbles: true })))
    await act(async () => controller.enqueue(encoder.encode(`event: tool_started\ndata: ${JSON.stringify({ thread_id: threadId, tool: 'get_pet', message: 'querying' })}\n\n`)))
    await waitFor(() => container.querySelector('[data-activity-key="tool:get_pet"]') !== null)
    expect(area.scrollTop).toBe(0)

    area.scrollTop = 780
    await act(async () => area.dispatchEvent(new Event('scroll', { bubbles: true })))
    await act(async () => {
      controller.enqueue(encoder.encode(`event: completed\ndata: ${JSON.stringify(completed('Pet details.').data)}\n\n`))
      controller.close()
    })
    await waitFor(() => container.textContent?.includes('Pet details.') === true)
    expect(area.scrollTop).toBeGreaterThan(780)
  })

  it('renders a completed answer and hides an empty Sources section', async () => {
    fetchMock.mockResolvedValue(streamResponse(
      { event: 'started', data: { thread_id: threadId, message: 'working' } },
      completed('Clinic answer is ready.'),
    ))

    await ask('What is the clinic policy?')
    await waitFor(() => container.textContent?.includes('Clinic answer is ready.') === true)

    expect(container.querySelector('.sources-block')).toBeNull()
    expect(container.querySelector('.activity-step[data-activity-key="completed"]')?.textContent).toContain('完成')
  })

  it('shows backend approval details and keeps one row per repeated tool', async () => {
    fetchMock.mockResolvedValue(streamResponse(
      { event: 'started', data: { thread_id: threadId, message: 'working' } },
      { event: 'tool_started', data: { thread_id: threadId, tool: 'get_appointment', message: 'querying' } },
      { event: 'tool_completed', data: { thread_id: threadId, tool: 'get_appointment', status: 200, message: 'done' } },
      { event: 'tool_started', data: { thread_id: threadId, tool: 'get_appointment', message: 'querying again' } },
      { event: 'tool_completed', data: { thread_id: threadId, tool: 'get_appointment', status: 200, message: 'done' } },
      approvalRequired(),
    ))

    await ask('取消预约5')
    await waitFor(() => container.querySelector('.approval-card') !== null)

    expect(container.querySelector('.approval-card h3')?.textContent).toBe('Cancel Appointment #5')
    expect(container.querySelectorAll('.activity-step[data-activity-key="tool:get_appointment"]')).toHaveLength(1)
    expect(container.querySelector('.activity-step[data-activity-key="tool:get_appointment"]')?.textContent).toContain('预约 #5 查询完成')
    expect(container.querySelector('.approval-details')?.textContent).toContain('REQUESTED')
    expect(container.querySelector('.approval-details')?.textContent).toContain('0')
  })

  it('keeps the approval history and closes its waiting state after Reject', async () => {
    fetchMock
      .mockResolvedValueOnce(streamResponse(approvalRequired()))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        thread_id: threadId, status: 'completed', message: '取消未执行：人工拒绝。',
      }), { status: 200 }))

    await ask('取消预约5')
    await waitFor(() => container.querySelector('.approval-card') !== null)
    await act(async () => container.querySelector<HTMLButtonElement>('.reject-button')!.click())
    await waitFor(() => container.querySelector('.approval-card') === null)

    expect(container.querySelector('.activity-step[data-activity-key="approval"]')?.textContent).toContain('审批已拒绝')
    expect(container.querySelector('.activity-step[data-activity-key="approval"]')?.classList.contains('done')).toBe(true)
    expect(container.querySelector('.activity-step[data-activity-key="resume-result"]')?.textContent).toContain('取消未执行')
  })

  it('marks an approved cancellation with a 409 conflict as failed activity', async () => {
    fetchMock
      .mockResolvedValueOnce(streamResponse(approvalRequired()))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        thread_id: threadId, status: 'completed', message: '取消未成功：HTTP 409 版本冲突。',
      }), { status: 200 }))

    await ask('取消预约5')
    await waitFor(() => container.querySelector('.approval-card') !== null)
    await act(async () => container.querySelector<HTMLButtonElement>('.approve-button')!.click())
    await waitFor(() => container.querySelector('.approval-card') === null)

    expect(container.querySelector('.activity-step[data-activity-key="approval"]')?.textContent).toContain('审批已通过')
    expect(container.querySelector('.activity-step[data-activity-key="resume-result"]')?.textContent).toContain('取消失败：版本冲突')
    expect(container.querySelector('.activity-step[data-activity-key="resume-result"]')?.classList.contains('error')).toBe(true)
    expect(Array.from(container.querySelectorAll('.message-row.assistant')).at(-1)?.textContent).toContain('409 版本冲突')
  })

  it('shows real Sources data and folds additional sources', async () => {
    fetchMock.mockResolvedValue(streamResponse(completed('Grounded answer.', {
      sources: [
        { title: 'Cancellation policy', section: 'Appointments', snippet: 'Appointments may be cancelled before the visit.' },
        { title: 'Booking guide', section: 'Scheduling', snippet: 'Call the clinic for changes.' },
        { title: 'Patient support', section: 'Help', snippet: 'Contact reception for assistance.' },
      ],
    })))

    await ask('What is the cancellation policy?')
    await waitFor(() => container.querySelector('.sources-block') !== null)

    expect(container.querySelector('.sources-heading')?.textContent).toContain('3')
    expect(container.querySelector('.sources-block')?.textContent).toContain('Cancellation policy')
    expect(container.querySelector('.sources-block')?.textContent).toContain('Appointments')
    expect(container.querySelector('.sources-block')?.textContent).toContain('Appointments may be cancelled')
    expect(container.querySelector('.sources-more')?.open).toBe(false)
  })

  it('shows SSE errors and restores the message for retry', async () => {
    fetchMock.mockResolvedValue(streamResponse(
      { event: 'started', data: { thread_id: threadId, message: 'working' } },
      { event: 'error', data: { thread_id: threadId, message: 'Knowledge service is unavailable.' } },
    ))

    await ask('查询预约5')
    await waitFor(() => container.querySelector('.error-banner') !== null)

    expect(container.querySelector('.error-banner')?.textContent).toContain('Knowledge service is unavailable.')
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('查询预约5')
    expect(container.querySelector<HTMLButtonElement>('.composer button[type="submit"]')?.disabled).toBe(false)
  })

  it('blocks duplicate submissions while a request is pending', async () => {
    let resolveFetch!: (response: Response) => void
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { resolveFetch = resolve }))
    await openDrawer()
    await enterText('Show pet 1')

    await act(async () => {
      const form = container.querySelector<HTMLFormElement>('.composer')!
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('.composer button[type="submit"]')?.disabled).toBe(true)

    await act(async () => resolveFetch(streamResponse(completed('Done.'))))
    await waitFor(() => container.textContent?.includes('Done.') === true)
  })

  it('continues the same thread and New conversation clears the frontend thread', async () => {
    fetchMock
      .mockResolvedValueOnce(streamResponse(completed('First answer.')))
      .mockResolvedValueOnce(streamResponse(completed('Second answer.')))
      .mockResolvedValueOnce(streamResponse(completed('Fresh answer.')))

    await ask('First question')
    await waitFor(() => container.textContent?.includes('First answer.') === true)
    await enterText('Follow up')
    await submit()
    await waitFor(() => container.textContent?.includes('Second answer.') === true)

    const followUpBody = JSON.parse(fetchMock.mock.calls[1][1].body as string) as { thread_id: string | null }
    expect(followUpBody.thread_id).toBe(threadId)
    expect(localStorage.getItem(threadStorageKey)).toBe(threadId)

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="New conversation"]')!.click())
    expect(container.textContent).not.toContain('First answer.')
    expect(localStorage.getItem(threadStorageKey)).toBeNull()
    await enterText('Fresh question')
    await submit()
    await waitFor(() => container.textContent?.includes('Fresh answer.') === true)

    const freshBody = JSON.parse(fetchMock.mock.calls[2][1].body as string) as { thread_id: string | null }
    expect(freshBody.thread_id).toBeNull()
  })

  it('restores completed conversation messages after a page reload', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(completed('Pet 1 is available.')))
    await ask('Show pet 1')
    await waitFor(() => localStorage.getItem(threadStorageKey) === threadId)

    await act(async () => root.unmount())
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      thread_id: threadId, status: 'completed',
      messages: [
        { role: 'user', content: 'Show pet 1' },
        { role: 'assistant', content: 'Pet 1 is available.' },
      ],
      approval: null,
    }), { status: 200 }))
    root = createRoot(container)
    await act(async () => root.render(<App />))
    await openDrawer()
    await waitFor(() => container.textContent?.includes('Pet 1 is available.') === true)

    expect(container.querySelector('.message-row.user')?.textContent).toBe('Show pet 1')
    expect(container.querySelector('.approval-card')).toBeNull()
    expect(fetchMock.mock.calls[1][0]).toBe(`/agent/${threadId}/state`)
    expect(localStorage.getItem(threadStorageKey)).toBe(threadId)
  })

  it('restores a pending approval after reload and resumes the same thread', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(approvalRequired()))
    await ask('取消预约5')
    await waitFor(() => container.querySelector('.approval-card') !== null)
    expect(localStorage.getItem(threadStorageKey)).toBe(threadId)

    await act(async () => root.unmount())
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      thread_id: threadId, status: 'approval_required',
      messages: [{ role: 'user', content: '取消预约5' }],
      approval: { action: 'cancel_appointment', appointmentId: 5, status: 'REQUESTED', expectedVersion: 0 },
    }), { status: 200 }))
    root = createRoot(container)
    await act(async () => root.render(<App />))
    await openDrawer()
    await waitFor(() => container.querySelector('.approval-card') !== null)

    expect(container.querySelector('.approval-card h3')?.textContent).toBe('Cancel Appointment #5')
    expect(container.querySelector('.approval-details')?.textContent).toContain('REQUESTED')
    expect(container.querySelector('.approval-details')?.textContent).toContain('0')
    expect(container.querySelector('.activity-step[data-activity-key="approval"]')?.classList.contains('waiting')).toBe(true)

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      thread_id: threadId, status: 'completed', message: '取消未执行：人工拒绝。',
    }), { status: 200 }))
    await act(async () => container.querySelector<HTMLButtonElement>('.reject-button')!.click())
    await waitFor(() => container.querySelector('.approval-card') === null)
    expect(fetchMock.mock.calls[2][0]).toBe(`/agent/${threadId}/resume`)
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({ decision: 'reject' })
  })

  it('lets New conversation clear a pending approval and saved thread', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(approvalRequired()))
    await ask('取消预约5')
    await waitFor(() => container.querySelector('.approval-card') !== null)

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="New conversation"]')!.click())
    expect(localStorage.getItem(threadStorageKey)).toBeNull()
    expect(container.querySelector('.approval-card')).toBeNull()
    expect(container.textContent).not.toContain('取消预约5')

    fetchMock.mockResolvedValueOnce(streamResponse(completed('Fresh conversation.')))
    await enterText('New question')
    await submit()
    await waitFor(() => container.textContent?.includes('Fresh conversation.') === true)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).thread_id).toBeNull()
  })

  it('clears a saved unknown thread and allows a new conversation', async () => {
    await act(async () => root.unmount())
    localStorage.setItem(threadStorageKey, 'missing-thread')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Unknown thread_id' }), { status: 404 }))
    root = createRoot(container)
    await act(async () => root.render(<App />))
    await openDrawer()
    await waitFor(() => container.querySelector('.error-banner') !== null)

    expect(localStorage.getItem(threadStorageKey)).toBeNull()
    expect(container.querySelector('.error-banner')?.textContent).toContain('no longer available')
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(false)
    fetchMock.mockResolvedValueOnce(streamResponse(completed('New thread is ready.')))
    await enterText('Show pet 1')
    await submit()
    await waitFor(() => container.textContent?.includes('New thread is ready.') === true)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).thread_id).toBeNull()
  })

  it('keeps the saved thread when the recovery endpoint is not available yet', async () => {
    await act(async () => root.unmount())
    localStorage.setItem(threadStorageKey, threadId)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 }))
    root = createRoot(container)
    await act(async () => root.render(<App />))
    await openDrawer()
    await waitFor(() => container.querySelector('.error-banner') !== null)

    expect(container.querySelector('.error-banner')?.textContent).toContain('recovery is not available')
    expect(localStorage.getItem(threadStorageKey)).toBe(threadId)
  })

  it('clears an expired approval thread and explains the resume failure', async () => {
    fetchMock
      .mockResolvedValueOnce(streamResponse(approvalRequired()))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Unknown thread_id' }), { status: 404 }))

    await ask('Cancel appointment 5')
    await waitFor(() => container.querySelector('.approval-card') !== null)
    await act(async () => container.querySelector<HTMLButtonElement>('.reject-button')!.click())
    await waitFor(() => container.querySelector('.error-banner') !== null)

    expect(container.querySelector('.approval-card')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('[aria-label="New conversation"]')?.disabled).toBe(false)
    expect(container.querySelector('.error-banner')?.textContent).toContain('conversation is no longer available')
  })

  it('rejects malformed SSE payloads without treating them as success', async () => {
    fetchMock.mockResolvedValue(new Response('event: completed\ndata: {"thread_id":"t","status":"completed","message":42}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    await ask('Query pet 1')
    await waitFor(() => container.querySelector('.error-banner') !== null)

    expect(container.querySelector('.error-banner')?.textContent).toContain('invalid message')
    expect(container.textContent).not.toContain('42')
  })
})
