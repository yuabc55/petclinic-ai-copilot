import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
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

/* Dr. Cleo Mascot Face with animated ears and blinking eyes */
function DrCleoAvatar({ size = 38 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" className="mascot-face-svg" aria-hidden="true">
      {/* Cat Head Base - Golden Shaded Fur */}
      <circle cx="22" cy="24" r="15" fill="#E8B868" />
      <circle cx="22" cy="24" r="14" fill="url(#catFurGrad)" />
      {/* Golden Shaded Cheeks */}
      <path d="M11 26c0 6 5 10 11 10s11-4 11-10c0-4-3-7-6-8-2 2-3 2-5 2s-3 0-5-2c-3 1-6 4-6 8z" fill="#FFF8EE" />
      {/* Left Ear with earTwitch animation */}
      <g className="mascot-ear-left">
        <polygon points="10,18 7,5 19,12" fill="#D49944" />
        <polygon points="10,16 9,8 16,13" fill="#FCE8D3" />
      </g>
      {/* Right Ear with earTwitch animation */}
      <g className="mascot-ear-right">
        <polygon points="34,18 37,5 25,12" fill="#D49944" />
        <polygon points="34,16 35,8 28,13" fill="#FCE8D3" />
      </g>
      {/* Blinking Green-Gold Eyes */}
      <g className="mascot-eye">
        <ellipse cx="16.5" cy="21" rx="2.5" ry="3.2" fill="#3D7D54" />
        <circle cx="15.8" cy="20" r="1" fill="#FFF" />
        <ellipse cx="27.5" cy="21" rx="2.5" ry="3.2" fill="#3D7D54" />
        <circle cx="26.8" cy="20" r="1" fill="#FFF" />
      </g>
      {/* Cute Pink Nose & Mouth */}
      <polygon points="22,25 20.5,23.5 23.5,23.5" fill="#E58D82" />
      <path d="M22 25v2.2M22 27.2c-1 0-2-.5-2-1.5M22 27.2c1 0 2-.5 2-1.5" stroke="#7A5228" strokeWidth="1.2" strokeLinecap="round" />
      {/* Whiskers */}
      <path d="M14 26l-6-1M14 28l-7 1M30 26l6-1M30 28l7 1" stroke="#BA9365" strokeWidth="1" strokeLinecap="round" />
      {/* Nurse Stethoscope Collar Charm */}
      <path d="M15 35c2 3 5 4 7 4s5-1 7-4" stroke="#4F6D7A" strokeWidth="2" strokeLinecap="round" />
      <circle cx="22" cy="39" r="2.2" fill="#C99A4A" stroke="#FFF" strokeWidth="0.8" />
      <defs>
        <radialGradient id="catFurGrad" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#F9D28A" />
          <stop offset="65%" stopColor="#DE9E46" />
          <stop offset="100%" stopColor="#A86C25" />
        </radialGradient>
      </defs>
    </svg>
  )
}

const navigation: { label: Page; description: string; icon: ReactNode }[] = [
  {
    label: 'Dashboard',
    description: 'Cinematic clinic overview & scene',
    icon: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  },
  {
    label: 'Pets',
    description: 'Patient registry and coat notes',
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
    setMascotMenuOpen(false)
    setDrawerOpen(true)
  }

  const workflowState = restoring ? 'restoring' : busy ? 'running' : error || activitySteps.some(step => step.state === 'error') ? 'error' : approval ? 'waiting' : 'ready'
  const workflowLabel = restoring ? 'Restoring conversation…' : busy
    ? pendingDecision === 'reject' ? 'Submitting rejection…' : pendingDecision === 'approve' ? 'Applying approved action…' : 'Processing request…'
    : error || activitySteps.some(step => step.state === 'error') ? 'Needs attention' : approval ? 'Waiting for your approval' : 'Ready to help'

  return (
    <div className="app-shell">
      <aside className="sidebar" inert={drawerOpen} aria-hidden={drawerOpen || undefined}>
        <button className="brand" onClick={() => setPage('Dashboard')} aria-label="PetClinic dashboard">
          <span className="brand-mark"><PetClinicCrossIcon size={22} /></span>
          <span className="brand-copy"><strong>petclinic</strong><small>EDITORIAL CONSOLE</small></span>
        </button>

        <div className="nav-group-label">SANCTUARY</div>
        <nav className="nav-list" aria-label="Main navigation">
          {navigation.map(item => (
            <button key={item.label} className={`nav-item ${page === item.label ? 'active' : ''}`} onClick={() => setPage(item.label)} aria-label={item.label} aria-current={page === item.label ? 'page' : undefined}>
              <Icon size={19}>{item.icon}</Icon><span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-agent-mark"><DrCleoAvatar size={24} /></div>
          <div><strong>Dr. Cleo Copilot</strong><span>Ready for consult</span></div>
          <button className="sidebar-agent-button" onClick={openDrawer} aria-label="Open Agent from navigation"><Icon size={17}><path d="m9 18 6-6-6-6"/></Icon></button>
        </div>
      </aside>

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
            <SectionPlaceholder page={page} onOpenAgent={openDrawer} />
          )}
        </div>
      </main>

      {/* DR. CLEO MASCOT DOCK WITH QUICK ACTIONS & FULL DRAWER LAUNCHER */}
      {!drawerOpen && (
        <div className="mascot-dock">
          {mascotMenuOpen && (
            <div className="mascot-popover" role="dialog" aria-label="Dr. Cleo Quick Actions">
              <div className="mascot-popover-header">
                <div className="mascot-popover-title">
                  <PawIcon size={14} />
                  <span>Dr. Cleo · Quick Actions</span>
                </div>
                <button className="mascot-close-btn" onClick={() => setMascotMenuOpen(false)} aria-label="Close Quick Actions">✕</button>
              </div>
              <p>Select a quick inquiry or open full copilot conversation:</p>
              <div className="mascot-prompts">
                <button className="mascot-prompt-btn" onClick={() => triggerPrompt('Show pet 1')}>
                  <span>🐾 Show patient records (Pet #1)</span>
                  <Icon size={14}><path d="m9 18 6-6-6-6"/></Icon>
                </button>
                <button className="mascot-prompt-btn" onClick={() => triggerPrompt('Show appointment 2')}>
                  <span>🗓️ Check appointment (#2)</span>
                  <Icon size={14}><path d="m9 18 6-6-6-6"/></Icon>
                </button>
                <button className="mascot-prompt-btn" onClick={() => triggerPrompt('Cancel appointment 5')}>
                  <span>⚠️ Cancel appointment (#5)</span>
                  <Icon size={14}><path d="m9 18 6-6-6-6"/></Icon>
                </button>
              </div>
            </div>
          )}

          {/* Primary trigger button holding .agent-launcher for full Vitest test suite compatibility */}
          <button
            ref={launcherRef}
            className="agent-launcher"
            onClick={openDrawer}
            onContextMenu={e => { e.preventDefault(); setMascotMenuOpen(!mascotMenuOpen) }}
            aria-label="Open Agent sidebar"
          >
            <span className="mascot-face-wrap"><DrCleoAvatar size={34} /></span>
            <span className="mascot-label">
              <strong>Ask Dr. Cleo</strong>
              <small>Click to chat · Right-click quick actions</small>
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
                  {message.role === 'assistant' ? <ReactMarkdown>{message.text}</ReactMarkdown> : message.text}
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
            <span className="poster-edition">PETCLINIC EDITORIAL EDITION · VOL. 2026</span>
            <h2>Where clinical precision meets <em>gentle intuition.</em></h2>
          </div>
          <div className="poster-pills">
            <span className="poster-pill"><PawIcon size={12} /> 18 Active Patients</span>
            <span className="poster-pill">● Human-in-the-loop Guard</span>
          </div>
        </div>

        {/* Cinematic Sunset Illustration Scene */}
        <div className="poster-canvas">
          <svg className="poster-svg-stage" viewBox="0 0 1000 520" fill="none" preserveAspectRatio="xMidYMid meet">
            <defs>
              {/* Sunset Ambient Gradient */}
              <radialGradient id="sunsetBeam" cx="72%" cy="25%" r="65%">
                <stop offset="0%" stopColor="#FDE1A9" stopOpacity="0.45" />
                <stop offset="40%" stopColor="#DE9E46" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#1E130B" stopOpacity="0" />
              </radialGradient>
              {/* Arched Window Gradient */}
              <linearGradient id="windowGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFF2D6" />
                <stop offset="60%" stopColor="#E9B96E" />
                <stop offset="100%" stopColor="#9C6228" />
              </linearGradient>
              {/* Mahogany Table Surface */}
              <linearGradient id="woodDesk" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#6E4426" />
                <stop offset="25%" stopColor="#4A2E1A" />
                <stop offset="100%" stopColor="#25160C" />
              </linearGradient>
              {/* Golden Shaded Cat Coat */}
              <linearGradient id="goldenCatGrad" x1="20%" y1="10%" x2="80%" y2="90%">
                <stop offset="0%" stopColor="#F9D490" />
                <stop offset="60%" stopColor="#D99742" />
                <stop offset="100%" stopColor="#824E19" />
              </linearGradient>
              {/* Cream Retriever Pup Fur */}
              <linearGradient id="creamPupGrad" x1="30%" y1="10%" x2="70%" y2="90%">
                <stop offset="0%" stopColor="#FFF7EB" />
                <stop offset="50%" stopColor="#EAD8BE" />
                <stop offset="100%" stopColor="#BFA582" />
              </linearGradient>
              {/* Doctor Linen Coat */}
              <linearGradient id="linenCoat" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FAF5EE" />
                <stop offset="70%" stopColor="#D8CDBC" />
                <stop offset="100%" stopColor="#9E907B" />
              </linearGradient>
            </defs>

            {/* Room Architecture: Sunset Wall & Golden Beam */}
            <rect width="1000" height="520" fill="#1C1109" />
            <circle cx="720" cy="140" r="380" fill="url(#sunsetBeam)" />

            {/* Arched Clinic Window */}
            <path d="M680 40 Q760 0 840 40 V300 H680 Z" fill="#2D1D13" stroke="#B8863B" strokeWidth="2" />
            <path d="M688 48 Q760 12 832 48 V292 H688 Z" fill="url(#windowGlow)" opacity="0.3" />
            {/* Window Muntins & Warm Rays */}
            <line x1="760" y1="12" x2="760" y2="292" stroke="#4A2F1C" strokeWidth="3" />
            <line x1="688" y1="140" x2="832" y2="140" stroke="#4A2F1C" strokeWidth="2.5" />
            <line x1="688" y1="210" x2="832" y2="210" stroke="#4A2F1C" strokeWidth="2" />
            {/* Sunlight Ray Shafts */}
            <polygon points="760,140 920,480 320,480 720,140" fill="#FFE2A4" opacity="0.08" />

            {/* Clinic Shelf & Amber Herbal Jars */}
            <rect x="80" y="80" width="220" height="12" rx="3" fill="#4A2E1A" />
            <rect x="110" y="52" width="22" height="28" rx="4" fill="#B56E26" opacity="0.75" />
            <rect x="140" y="44" width="26" height="36" rx="4" fill="#7A481B" opacity="0.8" />
            <rect x="175" y="56" width="20" height="24" rx="3" fill="#D4903E" opacity="0.7" />
            <path d="M220 50 Q240 30 260 55 Q275 80 250 92" stroke="#4D7A58" strokeWidth="3" fill="none" opacity="0.6" />

            {/* Consultation Desk (Mahogany Surface) */}
            <polygon points="120,380 960,380 900,520 60,520" fill="url(#woodDesk)" />
            <line x1="120" y1="380" x2="960" y2="380" stroke="#DDA85B" strokeWidth="2" opacity="0.6" />

            {/* ======================================================== */}
            {/* FIGURE 1: THE VETERINARIAN (Dr. Sarah Jenkins)           */}
            {/* ======================================================== */}
            <g id="figure-vet" className="scene-hotspot-group" onClick={() => onSelectPage('Vets')}>
              {/* Doctor Torso & Linen Scrubs Coat */}
              <path d="M200 480 Q210 320 280 290 Q340 300 370 480 Z" fill="url(#linenCoat)" />
              {/* Stethoscope around neck */}
              <path d="M260 330 C250 370 260 410 285 430 C310 440 325 410 320 370 C315 340 305 320 300 320" stroke="#3D5A6C" strokeWidth="4" fill="none" strokeLinecap="round" />
              <circle cx="285" cy="435" r="7" fill="#C99A4A" stroke="#FFF" strokeWidth="1.5" />
              {/* Doctor Head & Neck */}
              <path d="M275 295 L275 260 Q275 250 285 245 L300 245 Q310 250 310 260 L310 295 Z" fill="#D8A579" />
              {/* Head Profile & Kind Hair Knot */}
              <ellipse cx="292" cy="220" rx="26" ry="32" fill="#D8A579" />
              <path d="M265 210 Q280 170 320 190 Q325 210 320 235 Q300 215 270 230 Z" fill="#4A2612" />
              <circle cx="316" cy="188" r="14" fill="#3D1E0C" />
              {/* Clipboard in hand */}
              <rect x="330" y="360" width="60" height="85" rx="5" fill="#C9A066" transform="rotate(-12 330 360)" />
              <rect x="338" y="375" width="44" height="60" rx="2" fill="#FFFBF5" transform="rotate(-12 338 375)" />
            </g>

            {/* ======================================================== */}
            {/* FIGURE 2: THE GOLDEN SHADED CAT (Sunlit on Desk)         */}
            {/* ======================================================== */}
            <g id="figure-cat" className="scene-hotspot-group" onClick={() => onTriggerPrompt('Show pet 1')}>
              {/* Cat Body Lying Down */}
              <path d="M440 380 Q430 310 500 300 Q580 295 620 340 Q630 380 570 385 Z" fill="url(#goldenCatGrad)" />
              {/* Curled Tail draping over desk edge */}
              <path d="M610 360 C640 375 660 410 650 440 C640 465 615 460 610 440" stroke="url(#goldenCatGrad)" strokeWidth="14" strokeLinecap="round" fill="none" />
              {/* Cat Paws stretched gently */}
              <ellipse cx="445" cy="380" rx="18" ry="10" fill="#FFF2DC" />
              <ellipse cx="480" cy="383" rx="16" ry="9" fill="#FFF2DC" />
              {/* Cat Head */}
              <ellipse cx="450" cy="315" rx="30" ry="26" fill="url(#goldenCatGrad)" />
              <ellipse cx="450" cy="322" rx="20" ry="16" fill="#FFF8EE" />
              {/* Pointed Cat Ears */}
              <polygon points="430,300 415,265 445,285" fill="#D49944" />
              <polygon points="426,296 420,274 440,287" fill="#FCE8D3" />
              <polygon points="465,285 488,265 475,300" fill="#D49944" />
              <polygon points="468,287 482,274 474,296" fill="#FCE8D3" />
              {/* Green-Gold Eyes (Gentle Gaze) */}
              <ellipse cx="440" cy="315" rx="4" ry="5" fill="#3D7D54" />
              <circle cx="439" cy="313" r="1.5" fill="#FFF" />
              <ellipse cx="462" cy="315" rx="4" ry="5" fill="#3D7D54" />
              <circle cx="461" cy="313" r="1.5" fill="#FFF" />
              {/* Whiskers in Sunbeam */}
              <path d="M430 326 L395 320 M430 329 L390 330 M430 333 L395 338" stroke="#FFE9C7" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M472 326 L508 320 M472 329 L512 330 M472 333 L508 338" stroke="#FFE9C7" strokeWidth="1.6" strokeLinecap="round" />
            </g>

            {/* ======================================================== */}
            {/* FIGURE 3: THE CREAM PUPPY (Loyally Sitting Beside Table) */}
            {/* ======================================================== */}
            <g id="figure-dog" className="scene-hotspot-group" onClick={() => onTriggerPrompt('Show appointment 2')}>
              {/* Dog Body Sitting Attentively */}
              <path d="M720 520 Q700 370 780 340 Q850 350 860 520 Z" fill="url(#creamPupGrad)" />
              {/* Dog Head Tilted Toward Vet & Cat */}
              <ellipse cx="760" cy="330" rx="36" ry="42" fill="url(#creamPupGrad)" />
              {/* Soft Floppy Ear */}
              <path d="M724 315 C710 335 705 380 725 400 C735 410 745 390 740 360 Z" fill="#D2BBA0" />
              <path d="M790 315 C805 335 815 375 805 395 C795 405 785 385 788 355 Z" fill="#D2BBA0" />
              {/* Dog Muzzle & Nose */}
              <ellipse cx="756" cy="346" rx="20" ry="18" fill="#FFF8EE" />
              <ellipse cx="756" cy="338" rx="8" ry="6" fill="#3A2213" />
              {/* Loyal Dark Eyes */}
              <ellipse cx="742" cy="324" rx="4.5" ry="5.5" fill="#2E1B0E" />
              <circle cx="740" cy="322" r="1.5" fill="#FFF" />
              <ellipse cx="772" cy="324" rx="4.5" ry="5.5" fill="#2E1B0E" />
              <circle cx="770" cy="322" r="1.5" fill="#FFF" />
              {/* Leather Collar with Golden Brass Tag */}
              <path d="M730 385 Q760 400 790 385" stroke="#7A3920" strokeWidth="6" strokeLinecap="round" />
              <circle cx="760" cy="402" r="6" fill="#DDBB7A" stroke="#FFF" strokeWidth="1" />
            </g>

            {/* ======================================================== */}
            {/* DESK ACCESSORIES: Amber Lamp & Stethoscope               */}
            {/* ======================================================== */}
            {/* Amber Desk Lamp */}
            <path d="M880 380 L880 250 L840 290" stroke="#C99A4A" strokeWidth="5" strokeLinecap="round" />
            <path d="M820 300 Q850 270 870 300 Z" fill="#D48A2C" />
            <circle cx="845" cy="305" r="18" fill="#FFEAA8" opacity="0.35" />
          </svg>

          {/* ======================================================== */}
          {/* INTERACTIVE HOTSPOT PINS & FLOATING TOOLTIPS             */}
          {/* ======================================================== */}
          {/* Hotspot 1: Cat (Patient Records) */}
          <div className="scene-hotspot-wrap" style={{ top: '56%', left: '50%' }}>
            <button
              className="hotspot-btn"
              onClick={() => onTriggerPrompt('Show pet 1')}
              aria-label="Cat hotspot: Explore Patient Registry and pet profiles"
            >
              <div className="hotspot-ring hotspot-pulse"><PawIcon size={16} /></div>
              <div className="hotspot-tooltip">
                <strong><PawIcon size={14} /> Golden Shaded Cat</strong>
                <span>Active patient profiles, vaccination history & coat data.</span>
                <small>Click to query Pet #1 records →</small>
              </div>
            </button>
          </div>

          {/* Hotspot 2: Dog (Appointment Desk) */}
          <div className="scene-hotspot-wrap" style={{ top: '68%', left: '76%' }}>
            <button
              className="hotspot-btn"
              onClick={() => onTriggerPrompt('Show appointment 2')}
              aria-label="Dog hotspot: Explore Appointments and safe cancellation"
            >
              <div className="hotspot-ring hotspot-pulse"><Icon size={16}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></Icon></div>
              <div className="hotspot-tooltip">
                <strong><Icon size={14}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></Icon> Cream Pup Desk</strong>
                <span>Upcoming visits, scheduling & human-approved cancellations.</span>
                <small>Click to query Appointment #2 →</small>
              </div>
            </button>
          </div>

          {/* Hotspot 3: Veterinarian (Care Team Directory) */}
          <div className="scene-hotspot-wrap" style={{ top: '42%', left: '29%' }}>
            <button
              className="hotspot-btn"
              onClick={() => onSelectPage('Vets')}
              aria-label="Vet hotspot: Browse Care Team and clinic specialists"
            >
              <div className="hotspot-ring hotspot-pulse"><Icon size={16}><path d="M12 21s-8-4.6-8-10.7a4.6 4.6 0 0 1 8-3.1 4.6 4.6 0 0 1 8 3.1C20 16.4 12 21 12 21Z"/><path d="M9 12h6M12 9v6"/></Icon></div>
              <div className="hotspot-tooltip">
                <strong><Icon size={14}><path d="M12 21s-8-4.6-8-10.7a4.6 4.6 0 0 1 8-3.1 4.6 4.6 0 0 1 8 3.1C20 16.4 12 21 12 21Z"/><path d="M9 12h6M12 9v6"/></Icon> Dr. Jenkins & Team</strong>
                <span>Board-certified veterinary doctors & surgical specialists.</span>
                <small>Click to browse Care Team page →</small>
              </div>
            </button>
          </div>

          {/* Hotspot 4: Clinical Chart & Guidelines */}
          <div className="scene-hotspot-wrap" style={{ top: '76%', left: '36%' }}>
            <button
              className="hotspot-btn"
              onClick={() => onTriggerPrompt('What is the clinic policy for appointment cancellation?')}
              aria-label="Clipboard hotspot: Query clinic rules and grounded RAG knowledge"
            >
              <div className="hotspot-ring"><Icon size={15}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></Icon></div>
              <div className="hotspot-tooltip">
                <strong><Icon size={14}><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></Icon> Clinical Guidelines</strong>
                <span>RAG grounded knowledge base & cancellation protocols.</span>
                <small>Click to ask Agent about policies →</small>
              </div>
            </button>
          </div>
        </div>

        {/* Scene Index & Quick Jump Strip */}
        <div className="poster-legend">
          <div className="legend-label">
            <PawIcon size={14} />
            <span>INTERACTIVE SCENE HOTSPOTS</span>
          </div>
          <div className="legend-items">
            <button className="legend-btn" onClick={() => onTriggerPrompt('Show pet 1')}>
              <strong>[01]</strong> 🐾 Cat: Patient Registry
            </button>
            <button className="legend-btn" onClick={() => onTriggerPrompt('Show appointment 2')}>
              <strong>[02]</strong> 🗓️ Dog: Appointments
            </button>
            <button className="legend-btn" onClick={() => onSelectPage('Vets')}>
              <strong>[03]</strong> 🩺 Doctor: Care Team
            </button>
            <button className="legend-btn" onClick={() => onTriggerPrompt('What is the clinic cancellation policy?')}>
              <strong>[04]</strong> 📋 Desk: Knowledge RAG
            </button>
          </div>
        </div>
      </section>

      {/* Editorial Quickbar below poster */}
      <div className="editorial-quickbar">
        <div className="quickbar-copy">
          <div className="quickbar-badge"><DrCleoAvatar size={24} /></div>
          <div>
            <strong>Ask Dr. Cleo anything about patients, visits, or clinical rules</strong>
            <span>Transparent tool activity · Grounded RAG citations · Human-in-the-loop safeguards</span>
          </div>
        </div>
        <div className="quickbar-actions">
          <button className="quickbar-btn" onClick={() => onTriggerPrompt('Show pet 1')}><PawIcon size={13} /> Pet Records</button>
          <button className="quickbar-btn" onClick={() => onTriggerPrompt('Cancel appointment 5')}>⚠️ Review Cancellation</button>
          <button className="quickbar-btn" onClick={onOpenAgent}>Open Full Copilot →</button>
        </div>
      </div>
    </>
  )
}

function SectionPlaceholder({ page, onOpenAgent }: { page: Page; onOpenAgent: () => void }) {
  const item = navigation.find(entry => entry.label === page)!
  return <>
    <div className="page-heading">
      <div>
        <span className="eyebrow"><PawIcon size={13} /> SANCTUARY</span>
        <h1>{page}</h1>
        <p>{item.description}</p>
      </div>
    </div>
    <div className="section-placeholder">
      <div className="placeholder-icon"><Icon size={28}>{item.icon}</Icon></div>
      <span className="placeholder-eyebrow">COMING NEXT</span>
      <h2>{page} workspace</h2>
      <p>This dedicated clinical section is being built. In the meantime, Dr. Cleo and the PetClinic Agent can look up records, verify doctor schedules, and review appointment changes.</p>
      <button onClick={onOpenAgent}>Consult Dr. Cleo <Icon size={17}><path d="m5 12h14m-6-6 6 6-6 6"/></Icon></button>
    </div>
  </>
}

export default App
