import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { agentClient, isMockMode, type AgentResponse, type AgentSource, type AgentStreamEvent, type Approval } from './agentApi'

type Page = 'Dashboard' | 'Pets' | 'Appointments' | 'Vets'
type ChatMessage = { id: number; role: 'assistant' | 'user'; text: string; sources?: AgentSource[] }
type ActivityStep = { key: string; text: string; state: 'running' | 'done' | 'waiting' | 'error' }

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}

function PawIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="6.5" cy="8.5" r="2" />
      <circle cx="10.8" cy="5.8" r="2" />
      <circle cx="15.5" cy="6.5" r="2" />
      <circle cx="19.2" cy="10" r="2" />
      <path d="M12.5 10.5c-2.8 0-5 2-5 4.5 0 2.2 1.8 3.8 4.2 3.8s2.8-.7 3.6-.7 1.4.7 3.6.7c2.4 0 4.2-1.6 4.2-3.8 0-2.5-2.2-4.5-5-4.5-.8 0-1.6.2-2.3.6-.7-.4-1.5-.6-2.3-.6z" />
    </svg>
  )
}

function PetClinicCrossIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3h6v5h5v6h-5v7H9v-7H4V8h5V3z" fill="currentColor" fillOpacity="0.2" />
      <path d="M9 3h6v5h5v6h-5v7H9v-7H4V8h5V3z" />
      <path d="M7 6.5C6 5 4.5 5 4 6.5" strokeWidth="1.4" />
      <path d="M17 6.5C18 5 19.5 5 20 6.5" strokeWidth="1.4" />
    </svg>
  )
}

function DrCleoAvatar({ size = 38 }: { size?: number }) {
  return <img className="mascot-face-art" src="/dr-cleo.svg" width={size} height={size} alt="" aria-hidden="true" />
}

const navigation: { label: Page; description: string; icon: ReactNode }[] = [
  {
    label: 'Dashboard',
    description: 'Cinematic clinic overview & scene',
    icon: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  },
  {
    label: 'Pets',
    description: 'Pet records and information',
    icon: <><circle cx="6" cy="8" r="1.2"/><circle cx="10" cy="5" r="1.2"/><circle cx="15" cy="5" r="1.2"/><circle cx="19" cy="8" r="1.2"/><path d="M12 12c-2.5 0-6 3.4-6 5.5A2.5 2.5 0 0 0 8.5 20c1.3 0 2.2-.8 3.5-.8s2.2.8 3.5.8a2.5 2.5 0 0 0 2.5-2.5C18 15.4 14.5 12 12 12Z"/></>,
  },
  {
    label: 'Appointments',
    description: 'Visits and safe cancellations',
    icon: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 15h3"/><circle cx="16" cy="15" r="1.5" fill="currentColor"/></>,
  },
  {
    label: 'Vets',
    description: 'Care team and clinical specialties',
    icon: <><path d="M12 21s-8-4.6-8-10.7a4.6 4.6 0 0 1 8-3.1 4.6 4.6 0 0 1 8 3.1C20 16.4 12 21 12 21Z"/><path d="M9 12h6M12 9v6"/></>,
  },
]

const initial = agentClient.initialState()
const threadStorageKey = 'petclinic-agent-thread-id'

function readStoredThreadId(): string | null {
  if (isMockMode) return null
  try { return window.localStorage.getItem(threadStorageKey)?.trim() || null } catch { return null }
}

function saveThreadId(threadId: string | null) {
  if (isMockMode) return
  try {
    if (threadId) window.localStorage.setItem(threadStorageKey, threadId)
    else window.localStorage.removeItem(threadStorageKey)
  } catch {
    // The Agent remains usable when browser storage is unavailable.
  }
}

export function App() {
  const [page, setPage] = useState<Page>('Dashboard')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 0, role: 'assistant', text: initial.greeting }])
  const [approval, setApproval] = useState<Approval | null>(initial.approval)
  const [threadId, setThreadId] = useState<string | null>(() => readStoredThreadId() ?? initial.threadId)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(() => readStoredThreadId() !== null)
  const [activitySteps, setActivitySteps] = useState<ActivityStep[]>(initial.approval ? [{ key: 'approval', text: '等待人工审批…', state: 'waiting' }] : [])
  const [error, setError] = useState<string | null>(null)
  const [pendingDecision, setPendingDecision] = useState<'approve' | 'reject' | null>(null)
  const [mascotMenuOpen, setMascotMenuOpen] = useState(false)
  const busyRef = useRef(false)
  const currentRequestRef = useRef('')
  const nextId = useRef(1)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const mascotDockRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const followLatestRef = useRef(true)

  useEffect(() => {
    if (!drawerOpen || restoring || busy) return
    const target = approval ? drawerRef.current?.querySelector<HTMLButtonElement>('.reject-button') : inputRef.current
    target?.focus({ preventScroll: true })
  }, [drawerOpen, restoring, busy, approval])

  useEffect(() => {
    if (isMockMode || !threadId) return
    const savedId = threadId
    let active = true
    agentClient.getState(savedId).then(state => {
      if (!active) return
      if (state.thread_id !== savedId) throw new Error('The Agent API returned a different conversation ID.')
      const restored = state.messages.filter(message => message.content.trim()).map(message => ({
        id: nextId.current++, role: message.role, text: message.content,
      }))
      setMessages([{ id: 0, role: 'assistant', text: initial.greeting }, ...restored])
      setApproval(state.approval)
      setActivitySteps(state.status === 'approval_required'
        ? [{ key: 'approval', text: '等待人工审批…', state: 'waiting' }] : [])
      setError(null)
    }).catch(cause => {
      if (!active) return
      const message = cause instanceof Error ? cause.message : 'The conversation could not be restored.'
      if (/no longer available/i.test(message)) {
        clearConversation()
        setError('The saved Agent conversation is no longer available. You can start a new one.')
      } else {
        setError(`Could not restore the Agent conversation. ${message}`)
      }
    }).finally(() => { if (active) setRestoring(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (drawerOpen && conversationRef.current && followLatestRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight
    }
  }, [messages, activitySteps, approval, busy, drawerOpen, error])

  useEffect(() => {
    if (!drawerOpen) return
    const panel = drawerRef.current
    if (!panel) return
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')).filter(element => {
      let parent = element.parentElement
      while (parent && parent !== panel) {
        if (parent instanceof HTMLDetailsElement && !parent.open
          && !parent.querySelector(':scope > summary')?.contains(element)) return false
        parent = parent.parentElement
      }
      return true
    })
    if (!panel.contains(document.activeElement)) (focusable()[0] ?? panel).focus({ preventScroll: true })
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setDrawerOpen(false)
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0] ?? panel
      const last = items.at(-1) ?? panel
      const outside = !panel.contains(document.activeElement) || document.activeElement === panel
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyboard)
    return () => {
      window.removeEventListener('keydown', handleKeyboard)
      const target = returnFocusRef.current
      if (target?.isConnected) target.focus({ preventScroll: true })
      else launcherRef.current?.focus({ preventScroll: true })
    }
  }, [drawerOpen])

  useEffect(() => {
    if (!drawerOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [drawerOpen])

  useEffect(() => {
    if (!mascotMenuOpen || drawerOpen) return
    mascotDockRef.current?.querySelector<HTMLButtonElement>('.mascot-open-agent')?.focus({ preventScroll: true })
    const dismiss = (event: PointerEvent) => {
      if (!mascotDockRef.current?.contains(event.target as Node)) setMascotMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMascotMenuOpen(false)
      launcherRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', escape)
    }
  }, [mascotMenuOpen, drawerOpen])

  function addMessage(role: ChatMessage['role'], text: string) {
    setMessages(current => [...current, { id: nextId.current++, role, text }])
  }

  function updateThreadId(value: string | null) {
    setThreadId(value)
    saveThreadId(value)
  }

  function clearConversation(draft = '') {
    const next = agentClient.initialState()
    setMessages([{ id: nextId.current++, role: 'assistant', text: next.greeting }])
    updateThreadId(next.threadId)
    setApproval(next.approval)
    setActivitySteps([])
    setInput(draft)
    setError(null)
    followLatestRef.current = true
    currentRequestRef.current = ''
    inputRef.current?.focus()
  }

  function resetConversation() {
    if (busyRef.current || restoring) return
    clearConversation()
  }

  function applyResponse(response: AgentResponse) {
    updateThreadId(response.thread_id)
    if (response.status === 'approval_required') {
      setApproval(response.approval)
      addMessage('assistant', 'I found the appointment. Review the proposed action below before I continue.')
    } else {
      setApproval(null)
      setMessages(current => [...current, {
        id: nextId.current++, role: 'assistant', text: response.message,
        sources: Array.isArray(response.sources) && response.sources.length > 0 ? response.sources : undefined,
      }])
    }
  }

  function upsertActivity(key: string, text: string, state: ActivityStep['state']) {
    setActivitySteps(current => {
      const next = current.map(step => step.state === 'running' && step.key !== key ? { ...step, state: 'done' as const } : step)
      const index = next.findIndex(step => step.key === key)
      const update = { key, text, state }
      if (index >= 0) next[index] = update
      else next.push(update)
      return next
    })
  }

  function handleStreamEvent(event: AgentStreamEvent) {
    switch (event.type) {
      case 'started':
        setActivitySteps([{ key: 'understanding', text: '正在处理请求…', state: 'running' }])
        break
      case 'tool_started': {
        const requestedId = currentRequestRef.current.match(/(?:预约|appointment)\s*#?\s*(\d+)/i)?.[1]
        const petId = currentRequestRef.current.match(/(?:宠物|pet)\s*#?\s*(\d+)/i)?.[1]
        const label = event.tool === 'get_appointment' ? `正在查询预约${requestedId ? ` #${requestedId}` : ''}…`
          : event.tool === 'get_pet' ? `正在查询宠物${petId ? ` #${petId}` : ''}…`
            : event.tool === 'search_knowledge' ? '正在检索诊所规则…' : event.message
        upsertActivity(`tool:${event.tool}`, label, 'running')
        break
      }
      case 'tool_completed': {
        const requestedId = currentRequestRef.current.match(/(?:预约|appointment)\s*#?\s*(\d+)/i)?.[1]
        const petId = currentRequestRef.current.match(/(?:宠物|pet)\s*#?\s*(\d+)/i)?.[1]
        const label = event.tool === 'get_appointment' ? `预约${requestedId ? ` #${requestedId}` : ''} 查询完成`
          : event.tool === 'get_pet' ? `宠物${petId ? ` #${petId}` : ''} 查询完成`
            : event.tool === 'search_knowledge' ? '已检索诊所知识' : event.message
        upsertActivity(`tool:${event.tool}`, event.status !== null && event.status >= 400 ? `${label}（HTTP ${event.status}）` : label,
          event.status !== null && event.status >= 400 ? 'error' : 'done')
        break
      }
      case 'approval_required':
        upsertActivity('approval', '等待人工审批…', 'waiting')
        break
      case 'completed':
        upsertActivity('completed', '完成', 'done')
        break
      case 'error':
        setActivitySteps(current => {
          const next = current.map(step => step.state === 'running' ? { ...step, state: 'error' as const } : step)
          return next.some(step => step.state === 'error') ? next : [...next, { key: 'error', text: '执行遇到错误', state: 'error' }]
        })
        break
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    const message = input.trim()
    if (!message || busyRef.current || restoring || approval) return
    busyRef.current = true
    followLatestRef.current = true
    currentRequestRef.current = message
    setInput('')
    setError(null)
    setBusy(true)
    setActivitySteps([{ key: 'understanding', text: '正在连接 Agent…', state: 'running' }])
    const userMessageId = nextId.current++
    setMessages(current => [...current, { id: userMessageId, role: 'user', text: message }])
    try {
      applyResponse(await agentClient.chat(message, threadId, handleStreamEvent))
    } catch (cause) {
      setActivitySteps(current => current.map(step => step.state === 'running' ? { ...step, state: 'error' } : step))
      const messageText = cause instanceof Error ? cause.message : 'Something went wrong.'
      if (/no longer available/i.test(messageText)) clearConversation(message)
      else {
        setMessages(current => current.filter(item => item.id !== userMessageId))
        setInput(message)
      }
      setError(messageText)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function decide(decision: 'approve' | 'reject') {
    if (!threadId || busyRef.current || restoring) return
    busyRef.current = true
    followLatestRef.current = true
    setPendingDecision(decision)
    setBusy(true)
    setError(null)
    upsertActivity('resume', decision === 'approve' ? '正在执行操作…' : '正在提交拒绝决定…', 'running')
    try {
      const response = await agentClient.resume(threadId, decision)
      applyResponse(response)
      if (response.status === 'completed') {
        const success = /取消成功|成功取消|预约\s*\d+\s*已取消.*CANCELLED|successfully cancel(?:led|ed)/i.test(response.message)
        const conflict = /HTTP\s*409|版本冲突|version conflict/i.test(response.message)
        upsertActivity('approval', decision === 'reject' ? '审批已拒绝' : '审批已通过', 'done')
        upsertActivity('resume', decision === 'reject' ? '拒绝决定已提交' : '取消请求已提交', 'done')
        upsertActivity('resume-result', decision === 'reject' ? '已拒绝，取消未执行' : success ? '取消成功' : conflict ? '取消失败：版本冲突' : '操作结束，请查看 Agent 回复', conflict && decision === 'approve' ? 'error' : 'done')
      } else {
        upsertActivity('approval', '等待人工审批…', 'waiting')
      }
    } catch (cause) {
      setActivitySteps(current => current.map(step => step.state === 'running' ? { ...step, state: 'error' } : step))
      const message = cause instanceof Error ? cause.message : 'Something went wrong.'
      if (/no longer available|no longer pending/i.test(message)) {
        clearConversation()
      }
      setError(message)
    } finally {
      busyRef.current = false
      setBusy(false)
      setPendingDecision(null)
    }
  }

  function openDrawer(event?: { currentTarget: EventTarget }) {
    const target = event?.currentTarget ?? document.activeElement
    returnFocusRef.current = target instanceof HTMLElement && target !== document.body ? target : null
    followLatestRef.current = true
    setMascotMenuOpen(false)
    setDrawerOpen(true)
  }

  function triggerPrompt(promptText: string) {
    setInput(promptText)
    openDrawer()
  }

  const workflowState = restoring ? 'restoring' : busy ? 'running' : error || activitySteps.some(step => step.state === 'error') ? 'error' : approval ? 'waiting' : 'ready'
  const workflowLabel = restoring ? 'Restoring conversation…' : busy
    ? pendingDecision === 'reject' ? 'Submitting rejection…' : pendingDecision === 'approve' ? 'Applying approved action…' : 'Processing request…'
    : error || activitySteps.some(step => step.state === 'error') ? 'Needs attention' : approval ? 'Waiting for your approval' : 'Ready to help'

  return (
    <div className={`app-shell dashboard-scene${page === 'Dashboard' ? '' : ' section-scene'}`}>
      <aside className="sidebar" inert={drawerOpen} aria-hidden={drawerOpen || undefined}>
        <button className="brand" onClick={() => setPage('Dashboard')} aria-label="PetClinic dashboard">
          <span className="brand-mark"><PetClinicCrossIcon size={22} /></span>
          <span className="brand-copy"><strong>petclinic</strong><small>EDITORIAL CONSOLE</small></span>
        </button>

        <div className="nav-group-label">SANCTUARY</div>
        <nav className="nav-list" aria-label="Main navigation">
          {navigation.map((item, index) => (
            <button key={item.label} className={`nav-item ${page === item.label ? 'active' : ''}`} onClick={() => setPage(item.label)} aria-label={item.label} aria-current={page === item.label ? 'page' : undefined}>
              <span className="nav-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><Icon size={19}>{item.icon}</Icon><span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-agent-mark"><DrCleoAvatar size={24} /></div>
          <div><strong>Dr. Cleo Copilot</strong><span>Ready for consult</span></div>
          <button className="sidebar-agent-button" onClick={openDrawer} aria-label="Open Agent from navigation"><Icon size={17}><path d="m9 18 6-6-6-6"/></Icon></button>
        </div>
      </aside>

      {page !== 'Dashboard' && <SectionArt page={page} onOpenAgent={openDrawer} onTriggerPrompt={triggerPrompt} hidden={drawerOpen} />}

      <main className="main" inert={drawerOpen} aria-hidden={drawerOpen || undefined}>
        <header className="topbar">
          <div className="breadcrumb">Sanctuary <Icon size={14}><path d="m9 18 6-6-6-6"/></Icon><strong>{page}</strong></div>
          <div className="topbar-right"><span className="topbar-label">EDITORIAL POSTER EDITION</span><span className="topbar-avatar"><PawIcon size={15} /></span></div>
        </header>
        <div className="content">
          {page === 'Dashboard' ? (
            <EditorialPoster
              onOpenAgent={openDrawer}
              onSelectPage={setPage}
              onTriggerPrompt={triggerPrompt}
            />
          ) : (
            <SectionIntro page={page} onOpenAgent={openDrawer} />
          )}
        </div>
      </main>

      {/* DR. CLEO MASCOT DOCK WITH QUICK ACTIONS & FULL DRAWER LAUNCHER */}
      {!drawerOpen && (
        <div ref={mascotDockRef} className="mascot-dock">
          {mascotMenuOpen && (
            <div className="mascot-popover" role="dialog" aria-label="Dr. Cleo Quick Actions">
              <div className="mascot-popover-header">
                <div className="mascot-popover-title">
                  <PawIcon size={14} />
                  <span>Dr. Cleo · Quick Actions</span>
                </div>
                <button className="mascot-close-btn" onClick={() => { setMascotMenuOpen(false); launcherRef.current?.focus({ preventScroll: true }) }} aria-label="Close Quick Actions">✕</button>
              </div>
              <p>Select a quick inquiry or open full copilot conversation:</p>
              <div className="mascot-prompts">
                <button className="mascot-prompt-btn mascot-open-agent" onClick={openDrawer}>
                  <span>Open Agent conversation</span>
                  <Icon size={14}><path d="m9 18 6-6-6-6"/></Icon>
                </button>
                <button className="mascot-prompt-btn" onClick={() => triggerPrompt('Show pet ')}>
                  <span>🐾 Look up a pet — enter an ID</span>
                  <Icon size={14}><path d="m9 18 6-6-6-6"/></Icon>
                </button>
                <button className="mascot-prompt-btn" onClick={() => triggerPrompt('Show appointment ')}>
                  <span>🗓️ Look up an appointment — enter an ID</span>
                  <Icon size={14}><path d="m9 18 6-6-6-6"/></Icon>
                </button>
                <button className="mascot-prompt-btn" onClick={() => triggerPrompt('Cancel appointment ')}>
                  <span>⚠️ Review a cancellation — enter an ID</span>
                  <Icon size={14}><path d="m9 18 6-6-6-6"/></Icon>
                </button>
              </div>
            </div>
          )}

          {/* Primary Dr. Cleo trigger; the Agent opens from its Quick Actions. */}
          <button
            ref={launcherRef}
            className="agent-launcher"
            onClick={() => setMascotMenuOpen(value => !value)}
            aria-label="Open Agent sidebar"
            aria-expanded={mascotMenuOpen}
            aria-haspopup="dialog"
          >
            <span className="mascot-face-wrap"><DrCleoAvatar size={34} /></span>
            <span className="mascot-label">
              <strong>Ask Dr. Cleo</strong>
              <small>Clinic quick actions</small>
            </span>
            <Icon size={16}><path d="m5 12h14m-6-6 6 6-6 6"/></Icon>
          </button>
        </div>
      )}

      {/* FULL AGENT DRAWER */}
      {drawerOpen && <>
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
        <aside ref={drawerRef} className="agent-drawer" role="dialog" aria-modal="true" aria-label="Agent sidebar" tabIndex={-1}>
          <header className="drawer-header">
            <div className="agent-icon"><DrCleoAvatar size={28} /></div>
            <div className="drawer-title"><span>CLINICAL COPILOT</span><strong>Dr. Cleo · PetClinic Agent</strong></div>
            <div className="drawer-header-actions">
              <button className="icon-button" onClick={resetConversation} disabled={busy || restoring} aria-label="New conversation" title="New conversation"><Icon size={19}><path d="M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6"/><path d="M16 4h5m-2.5-2.5v5M9 12h5"/></Icon></button>
              <button className="icon-button" onClick={() => setDrawerOpen(false)} aria-label="Close Agent sidebar"><Icon size={19}><path d="M18 6 6 18M6 6l12 12"/></Icon></button>
            </div>
          </header>

          <div className={`drawer-status ${workflowState}`}><span className="status-dot"/><span>{workflowLabel}</span><span className="mode-badge">{isMockMode ? 'Preview mode' : 'Agent API'}</span></div>

          <div className="conversation" ref={conversationRef} role="log" aria-live="polite" onScroll={event => { const area = event.currentTarget; followLatestRef.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80 }}>
            <div className="conversation-label"><span/>CONVERSATION<span/></div>
            {messages.map(message => (
              <div className={`message-row ${message.role}`} key={message.id}>
                {message.role === 'assistant' && <div className="message-avatar"><DrCleoAvatar size={20} /></div>}
                <div className="message-content">
                  {message.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                    table: ({ children }) => <div className="message-table-scroll" role="region" aria-label="Agent response table" tabIndex={0}>
                      <table>{children}</table>
                    </div>,
                  }}>{message.text}</ReactMarkdown> : message.text}
                  {message.sources && message.sources.length > 0 && <Sources sources={message.sources} />}
                </div>
              </div>
            ))}

            {messages.length === 1 && !approval && !restoring && (
              <div className="prompt-starters">
                <span>START WITH A PROMPT</span>
                {['Show pet ', 'Show appointment ', 'Cancel appointment '].map(prompt => (
                  <button key={prompt} onClick={() => { setInput(prompt); inputRef.current?.focus() }}>
                    <PawIcon size={13} /> {prompt.trim()} <Icon size={14}><path d="m5 12h14m-6-6 6 6-6 6"/></Icon>
                  </button>
                ))}
              </div>
            )}

            {activitySteps.length > 0 && <ActivityTimeline steps={activitySteps} busy={busy} />}

            {approval && <ApprovalCard approval={approval} busy={busy || restoring} pendingDecision={pendingDecision} onDecision={decide} />}
            {error && <div className="error-banner" role="alert"><strong>Unable to complete the request</strong><span>{error}</span></div>}
          </div>

          <div className="composer-area">
            {isMockMode && <div className="preview-note">Preview mode · no clinic data is changed</div>}
            <form className="composer" onSubmit={event => void send(event)}>
              <textarea ref={inputRef} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder={approval ? 'Review the action above to continue' : 'Ask Dr. Cleo about pets, appointments, or policies…'} aria-label="Message Agent" rows={2} disabled={busy || restoring || !!approval} />
              <div className="composer-footer"><span>Enter to send · Shift + Enter for new line</span><button type="submit" disabled={!input.trim() || busy || restoring || !!approval} aria-label="Send message"><Icon size={17}><path d="m5 12 14-8-3 16-4-6-7-2Z"/><path d="m12 14 7-10"/></Icon></button></div>
            </form>
            <p className="drawer-footnote">Any appointment change waits for your explicit clinical decision.</p>
          </div>
        </aside>
      </>}
    </div>
  )
}

function ActivityTimeline({ steps, busy }: { steps: ActivityStep[]; busy: boolean }) {
  const attention = steps.some(step => step.state === 'error')
  const waiting = steps.some(step => step.state === 'waiting')
  const settled = !busy && !waiting && !attention
  const current = steps.find(step => step.state === 'running')
  const summary = busy ? current?.text ?? '正在处理请求…' : attention ? '执行需要关注' : waiting ? '等待人工审批…' : '执行已结束'
  return <div className={`tool-card${settled ? ' settled' : ''}`} role="status" aria-label="Agent activity">
    <div className="tool-icon"><Icon size={17}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10h8M8 14h5"/></Icon></div>
    <details className="tool-copy" open={!settled}>
      <summary className="activity-summary"><span>TOOL ACTIVITY</span><strong>{summary}</strong><small>{steps.length} steps</small></summary>
      <div className="activity-list">{steps.map(step => <div className={`activity-step ${step.state}`} data-activity-key={step.key} key={step.key}><span className="activity-mark">{step.state === 'running' ? <span className="spinner"/> : step.state === 'done' ? '✓' : step.state === 'waiting' ? '·' : '!'}</span><strong>{step.text}</strong></div>)}</div>
    </details>
  </div>
}

function Sources({ sources }: { sources: AgentSource[] }) {
  const [featured, ...additional] = sources
  return <section className="sources-block" aria-label="Sources">
    <div className="sources-heading">Sources <span>{sources.length}</span></div>
    <SourceCard source={featured} />
    {additional.length > 0 && <details className="sources-more"><summary>View {additional.length} more {additional.length === 1 ? 'source' : 'sources'}</summary><div className="sources-more-list">{additional.map((source, index) => <SourceCard key={`${source.title}-${source.section}-${index}`} source={source} />)}</div></details>}
  </section>
}

function SourceCard({ source }: { source: AgentSource }) {
  return <article className="source-item">
    <strong>{source.title}</strong><span>{source.section}</span>
    <details className="source-excerpt"><summary>Read excerpt</summary><p>{source.snippet}</p></details>
  </article>
}

function ApprovalCard({ approval, busy, pendingDecision, onDecision }: { approval: Approval; busy: boolean; pendingDecision: 'approve' | 'reject' | null; onDecision: (decision: 'approve' | 'reject') => void }) {
  const action = approval.action.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  return <div className="approval-card" aria-labelledby="approval-title" aria-describedby="approval-description">
    <div className="approval-top"><div className="approval-symbol"><Icon size={18}><path d="M12 3 3 7v5c0 5 3.5 8 9 9 5.5-1 9-4 9-9V7l-9-4Z"/><path d="M12 8v5M12 16h.01"/></Icon></div><span>YOUR DECISION NEEDED</span></div>
    <h3 id="approval-title">{action} #{approval.appointmentId}</h3>
    <p id="approval-description">{approval.action === 'cancel_appointment' ? 'Approve to authorize cancellation. Reject to keep the appointment unchanged.' : 'Review this action before authorizing the Agent to proceed.'}</p>
    <div className="approval-details"><div><span>Current status</span><strong>{approval.status}</strong></div><div><span>Expected version</span><strong>{approval.expectedVersion}</strong></div><div className="approval-action-field"><span>Requested action</span><code>{approval.action}</code></div></div>
    <p className="approval-audit-note">The displayed version is used for this decision. A changed record can cause a conflict.</p>
    <div className="approval-actions">
      <button type="button" className="reject-button" disabled={busy} onClick={() => onDecision('reject')}>{pendingDecision === 'reject' ? 'Rejecting…' : 'Reject'}</button>
      <button type="button" className="approve-button" disabled={busy} onClick={() => onDecision('approve')}>{pendingDecision === 'approve' ? 'Approving…' : 'Approve'}</button>
    </div>
  </div>
}

/* ========================================================================= */
/* INTERACTIVE EDITORIAL PETCLINIC POSTER COMPONENT                          */
/* ========================================================================= */
function SceneHotspot({ position, label, title, subtitle, description, icon, actions }: {
  position: { top: string; left: string }
  label: string
  title: string
  subtitle?: string
  description: string
  icon: ReactNode
  actions: { label: string; run: () => void }[]
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const dismiss = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  return <div ref={wrapperRef} className={`scene-hotspot-wrap${subtitle ? ' knowledge-hotspot' : ''}${open ? ' is-open' : ''}`} style={position}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false) }}
    onKeyDown={event => {
      if (event.key === 'Escape' && open) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus({ preventScroll: true })
      }
    }}>
    <button ref={triggerRef} className="hotspot-btn" aria-label={label} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(value => !value)}>
      <span className="hotspot-ring">{icon}</span>
      <span className="hotspot-label"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
      <span className="hotspot-tooltip" aria-hidden="true"><strong>{title}</strong><span>{description}</span></span>
    </button>
    {open && <div id={panelId} ref={panelRef} className="scene-quick-actions" role="group" aria-label={`${title} quick actions`}>
      <span>{title}</span>
      {actions.map(action => <button key={action.label} onClick={() => {
        setOpen(false)
        triggerRef.current?.focus({ preventScroll: true })
        action.run()
      }}>{action.label}<span aria-hidden="true">↗</span></button>)}
    </div>}
  </div>
}

function EditorialPoster({
  onOpenAgent,
  onSelectPage,
  onTriggerPrompt,
}: {
  onOpenAgent: () => void
  onSelectPage: (page: Page) => void
  onTriggerPrompt: (prompt: string) => void
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow"><PawIcon size={13} /> EDITORIAL SANCTUARY</span>
          <h1>Clinical Sanctuary & Workspace</h1>
          <p>An interactive, human-and-animal care environment. Tap characters to explore records.</p>
        </div>
        <span className="page-badge"><span aria-hidden="true" /> COPILOT READY</span>
      </div>

      <section className="editorial-poster" aria-label="Interactive PetClinic Editorial Scene">
        {/* Magazine Masthead Overlay */}
        <div className="poster-masthead">
          <div>
            <span className="poster-edition">PETCLINIC / A SHARED SPACE FOR CARE</span>
            <h2>A quieter moment.<br /><em>A little more care.</em></h2>
          </div>
          <div className="poster-pills">
            <span className="poster-pill"><PawIcon size={12} /> People & companions</span>
            <span className="poster-pill">Changes require your approval</span>
          </div>
        </div>

        {/* Cinematic Sunset Illustration Scene */}
        <div className="poster-canvas">
          <div className="poster-scene-description" role="img" aria-label="A veterinarian, a golden cat and a cream dog share a warmly lit clinic" />

          {/* ======================================================== */}
          {/* INTERACTIVE HOTSPOT PINS & FLOATING TOOLTIPS             */}
          {/* ======================================================== */}
          <SceneHotspot position={{ top: '79%', left: '32%' }} label="Cat hotspot: Explore Patient Registry and pet profiles" title="Cat · Pet records" description="Look up a pet or open the Pets workspace." icon={<PawIcon size={16} />} actions={[
            { label: 'Look up a pet', run: () => onTriggerPrompt('Show pet ') },
            { label: 'Open Pets workspace', run: () => onSelectPage('Pets') },
          ]} />
          <SceneHotspot position={{ top: '81%', left: '79%' }} label="Dog hotspot: Explore Appointments and safe cancellation" title="Dog · Appointments" description="Look up an appointment or review a cancellation." icon={<Icon size={16}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></Icon>} actions={[
            { label: 'Look up an appointment', run: () => onTriggerPrompt('Show appointment ') },
            { label: 'Review a cancellation', run: () => onTriggerPrompt('Cancel appointment ') },
          ]} />
          <SceneHotspot position={{ top: '30%', left: '70%' }} label="Vet hotspot: Browse Care Team and clinic specialists" title="Vet · Care team" description="Open the Vets workspace or ask the Agent." icon={<Icon size={16}><path d="M9 3h6v6h6v6H9v-6H3V9h6Z"/></Icon>} actions={[
            { label: 'Open Vets workspace', run: () => onSelectPage('Vets') },
            { label: 'Open PetClinic Agent', run: onOpenAgent },
          ]} />
          <SceneHotspot position={{ top: '89%', left: '56%' }} label="Clipboard hotspot: Query clinic rules and grounded RAG knowledge" title="Clinic Knowledge" subtitle="Search policies & guidance" description="Ask the Agent to search clinic policies and guidance." icon={<Icon size={16}><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6M9 10h6M9 15h6"/></Icon>} actions={[
            { label: 'Ask about cancellation rules', run: () => onTriggerPrompt('What is the clinic policy for appointment cancellation?') },
            { label: 'Open PetClinic Agent', run: onOpenAgent },
          ]} />
        </div>

        {/* Scene Index & Quick Jump Strip */}
        <div className="poster-legend">
          <div className="legend-label">
            <PawIcon size={14} />
            <span>EXPLORE THE SCENE</span>
          </div>
          <div className="legend-items">
            <button className="legend-btn" onClick={() => onTriggerPrompt('Show pet ')}>
              <strong>[01]</strong> Cat / Pet records
            </button>
            <button className="legend-btn" onClick={() => onTriggerPrompt('Show appointment ')}>
              <strong>[02]</strong> Dog / Appointments
            </button>
            <button className="legend-btn" onClick={() => onSelectPage('Vets')}>
              <strong>[03]</strong> Vet / Care team
            </button>
            <button className="legend-btn" onClick={() => onTriggerPrompt('What is the clinic cancellation policy?')}>
              <strong>[04]</strong> Chart / Clinic policies
            </button>
          </div>
        </div>
      </section>

      {/* Editorial Quickbar below poster */}
      <div className="editorial-quickbar">
        <div className="quickbar-copy">
          <div className="quickbar-badge"><DrCleoAvatar size={24} /></div>
          <div>
            <strong>Everyday care, with you in control.</strong>
            <span>Live records · Clinic sources · Your approval</span>
          </div>
        </div>
        <div className="quickbar-actions">
          <button className="quickbar-btn" onClick={() => onTriggerPrompt('Show pet ')}><PawIcon size={13} /> Pet Records</button>
          <button className="quickbar-btn" onClick={() => onTriggerPrompt('Cancel appointment ')}>Review Cancellation</button>
          <button className="quickbar-btn" onClick={onOpenAgent}>Open Full Copilot →</button>
        </div>
      </div>
    </>
  )
}

function SectionArt({ page, onOpenAgent, onTriggerPrompt, hidden }: {
  page: Exclude<Page, 'Dashboard'>
  onOpenAgent: () => void
  onTriggerPrompt: (prompt: string) => void
  hidden: boolean
}) {
  return <div className="section-art" inert={hidden} aria-hidden={hidden || undefined}>
    <div className="section-art-image">
      <img src="/clinic-editorial-v1.webp" alt="A veterinarian with a cat and a dog in a warmly lit clinic" />
      {page === 'Pets' && <>
        <button className="section-cue cue-cat" onClick={() => onTriggerPrompt('Show pet ')} aria-label="Ask Dr. Cleo about pet records near the cat"><span className="cue-dot"/><span className="cue-label">Ask about pets</span></button>
        <button className="section-cue cue-dog" onClick={() => onTriggerPrompt('Show pet ')} aria-label="Ask Dr. Cleo about pet records near the dog"><span className="cue-dot"/><span className="cue-label">Ask about pets</span></button>
      </>}
      {page === 'Appointments' && <button className="section-cue cue-chart" onClick={() => onTriggerPrompt('Show appointment ')} aria-label="Ask Dr. Cleo about an appointment near the clinic chart"><span className="cue-dot"/><span className="cue-label">Ask about an appointment</span></button>}
      {page === 'Vets' && <button className="section-cue cue-vet" onClick={onOpenAgent} aria-label="Open Dr. Cleo near the veterinarian"><span className="cue-dot"/><span className="cue-label">Ask Dr. Cleo</span></button>}
    </div>
  </div>
}

function SectionIntro({ page, onOpenAgent }: { page: Page; onOpenAgent: () => void }) {
  const item = navigation.find(entry => entry.label === page)!
  return <div className="section-intro">
    <span className="section-kicker"><PawIcon size={13} /> THE CARE SCENE</span>
    <h1>{page}</h1>
    <p>{item.description}. Ask Dr. Cleo for available clinic information.</p>
    <button onClick={onOpenAgent}>Open Dr. Cleo <Icon size={17}><path d="m5 12h14m-6-6 6 6-6 6"/></Icon></button>
  </div>
}

export default App
