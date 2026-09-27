import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { agentClient, isMockMode, type AgentResponse, type AgentSource, type AgentStreamEvent, type Approval } from './agentApi'

type Page = 'Dashboard' | 'Pets' | 'Appointments' | 'Vets'
type ChatMessage = { id: number; role: 'assistant' | 'user'; text: string; sources?: AgentSource[] }
type ActivityStep = { key: string; text: string; state: 'running' | 'done' | 'waiting' | 'error' }

const navigation: { label: Page; description: string; icon: ReactNode }[] = [
  {
    label: 'Dashboard',
    description: 'Your workspace overview',
    icon: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  },
  {
    label: 'Pets',
    description: 'Patient information',
    icon: <><circle cx="6" cy="8" r="1"/><circle cx="10" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="19" cy="8" r="1"/><path d="M12 12c-2.5 0-6 3.4-6 5.5A2.5 2.5 0 0 0 8.5 20c1.3 0 2.2-.8 3.5-.8s2.2.8 3.5.8a2.5 2.5 0 0 0 2.5-2.5C18 15.4 14.5 12 12 12Z"/></>,
  },
  {
    label: 'Appointments',
    description: 'Visits and scheduling',
    icon: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 15h3"/></>,
  },
  {
    label: 'Vets',
    description: 'Care team',
    icon: <><path d="M12 21s-8-4.6-8-10.7a4.6 4.6 0 0 1 8-3.1 4.6 4.6 0 0 1 8 3.1C20 16.4 12 21 12 21Z"/><path d="M9 12h6M12 9v6"/></>,
  },
]

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}

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
  const busyRef = useRef(false)
  const currentRequestRef = useRef('')
  const nextId = useRef(1)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const conversationRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (drawerOpen && !restoring) inputRef.current?.focus()
  }, [drawerOpen, restoring])

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
    if (drawerOpen && conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight
    }
  }, [messages, activitySteps, approval, busy, drawerOpen])

  useEffect(() => {
    if (!drawerOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
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
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage('Dashboard')} aria-label="PetClinic dashboard">
          <span className="brand-mark">✳</span>
          <span className="brand-copy"><strong>petclinic</strong><small>CONSOLE</small></span>
        </button>

        <div className="nav-group-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          {navigation.map(item => (
            <button key={item.label} className={`nav-item ${page === item.label ? 'active' : ''}`} onClick={() => setPage(item.label)} aria-label={item.label} aria-current={page === item.label ? 'page' : undefined}>
              <Icon size={19}>{item.icon}</Icon><span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-agent-mark">✳</div>
          <div><strong>PetClinic Agent</strong><span>Available in your workspace</span></div>
          <button className="sidebar-agent-button" onClick={() => setDrawerOpen(true)} aria-label="Open Agent from navigation"><Icon size={17}><path d="m9 18 6-6-6-6"/></Icon></button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">Workspace <Icon size={14}><path d="m9 18 6-6-6-6"/></Icon><strong>{page}</strong></div>
          <div className="topbar-right"><span className="topbar-label">PETCLINIC CONSOLE</span><span className="topbar-avatar">PC</span></div>
        </header>
        <div className="content">
          {page === 'Dashboard' ? <Dashboard onOpenAgent={() => setDrawerOpen(true)} onSelectPage={setPage} /> : <SectionPlaceholder page={page} onOpenAgent={() => setDrawerOpen(true)} />}
        </div>
      </main>

      {!drawerOpen && <button className="agent-launcher" onClick={() => setDrawerOpen(true)} aria-label="Open Agent sidebar"><span>✳</span> Ask Agent <Icon size={16}><path d="m5 12h14m-6-6 6 6-6 6"/></Icon></button>}

      {drawerOpen && <>
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
        <aside className="agent-drawer" aria-label="Agent sidebar">
          <header className="drawer-header">
            <div className="agent-icon">✳</div>
            <div className="drawer-title"><span>YOUR ASSISTANT</span><strong>PetClinic Agent</strong></div>
            <div className="drawer-header-actions">
              <button className="icon-button" onClick={resetConversation} disabled={busy || restoring} aria-label="New conversation" title="New conversation"><Icon size={19}><path d="M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6"/><path d="M16 4h5m-2.5-2.5v5M9 12h5"/></Icon></button>
              <button className="icon-button" onClick={() => setDrawerOpen(false)} aria-label="Close Agent sidebar"><Icon size={19}><path d="M18 6 6 18M6 6l12 12"/></Icon></button>
            </div>
          </header>

          <div className="drawer-status"><span className="status-dot"/><span>{restoring ? 'Restoring conversation…' : 'Ready to help'}</span><span className="mode-badge">{isMockMode ? 'Preview mode' : 'Agent API'}</span></div>

          <div className="conversation" ref={conversationRef} role="log" aria-live="polite">
            <div className="conversation-label"><span/>CONVERSATION<span/></div>
            {messages.map(message => (
              <div className={`message-row ${message.role}`} key={message.id}>
                {message.role === 'assistant' && <div className="message-avatar">✳</div>}
                <div className="message-content">
                  {message.role === 'assistant' ? <ReactMarkdown>{message.text}</ReactMarkdown> : message.text}
                  {message.sources && message.sources.length > 0 && <Sources sources={message.sources} />}
                </div>
              </div>
            ))}

            {messages.length === 1 && !approval && !restoring && <div className="prompt-starters"><span>START WITH A PROMPT</span>{['Show pet ', 'Show appointment ', 'Cancel appointment '].map(prompt => <button key={prompt} onClick={() => { setInput(prompt); inputRef.current?.focus() }}>{prompt.trim()} <Icon size={15}><path d="m5 12h14m-6-6 6 6-6 6"/></Icon></button>)}</div>}

            {activitySteps.length > 0 && <div className="tool-card" role="status" aria-label="Agent activity"><div className="tool-icon"><Icon size={17}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10h8M8 14h5"/></Icon></div><div className="tool-copy"><span>TOOL ACTIVITY</span><div className="activity-list">{activitySteps.map((step, index) => <div className={`activity-step ${step.state}`} data-activity-key={step.key} key={index}><span className="activity-mark">{step.state === 'running' ? <span className="spinner"/> : step.state === 'done' ? '✓' : step.state === 'waiting' ? '·' : '!'}</span><strong>{step.text}</strong></div>)}</div></div></div>}

            {approval && <ApprovalCard approval={approval} busy={busy || restoring} onDecision={decide} />}
            {error && <div className="error-banner" role="alert"><strong>Unable to complete the request</strong><span>{error}</span></div>}
          </div>

          <div className="composer-area">
            {isMockMode && <div className="preview-note">Preview mode · no clinic data is changed</div>}
            <form className="composer" onSubmit={event => void send(event)}>
              <textarea ref={inputRef} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder={approval ? 'Review the action above to continue' : 'Ask about a pet or appointment…'} aria-label="Message Agent" rows={2} disabled={busy || restoring || !!approval} />
              <div className="composer-footer"><span>Enter to send · Shift + Enter for new line</span><button type="submit" disabled={!input.trim() || busy || restoring || !!approval} aria-label="Send message"><Icon size={17}><path d="m5 12 14-8-3 16-4-6-7-2Z"/><path d="m12 14 7-10"/></Icon></button></div>
            </form>
            <p className="drawer-footnote">Any appointment change waits for your approval.</p>
          </div>
        </aside>
      </>}
    </div>
  )
}

function Sources({ sources }: { sources: AgentSource[] }) {
  const [featured, ...additional] = sources
  return <section className="sources-block" aria-label="Sources">
    <div className="sources-heading">Sources <span>{sources.length}</span></div>
    <SourceCard source={featured} expanded={sources.length === 1} />
    {additional.length > 0 && <details className="sources-more"><summary>View {additional.length} more {additional.length === 1 ? 'source' : 'sources'}</summary><div className="sources-more-list">{additional.map((source, index) => <SourceCard key={`${source.title}-${source.section}-${index}`} source={source} />)}</div></details>}
  </section>
}

function SourceCard({ source, expanded = false }: { source: AgentSource; expanded?: boolean }) {
  return <article className="source-item">
    <strong>{source.title}</strong><span>{source.section}</span>
    <details className="source-excerpt" open={expanded}><summary>{expanded ? 'Excerpt' : 'Read excerpt'}</summary><p>{source.snippet}</p></details>
  </article>
}

function ApprovalCard({ approval, busy, onDecision }: { approval: Approval; busy: boolean; onDecision: (decision: 'approve' | 'reject') => void }) {
  const action = approval.action.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  return <div className="approval-card">
    <div className="approval-top"><div className="approval-symbol"><Icon size={18}><path d="M12 3 3 7v5c0 5 3.5 8 9 9 5.5-1 9-4 9-9V7l-9-4Z"/><path d="M12 8v5M12 16h.01"/></Icon></div><span>YOUR DECISION NEEDED</span></div>
    <h3>{action} #{approval.appointmentId}</h3>
    <p>The Agent has paused before making this change.</p>
    <div className="approval-details"><div><span>Current status</span><strong>{approval.status}</strong></div><div><span>Version</span><strong>{approval.expectedVersion}</strong></div></div>
    <div className="approval-actions"><button className="reject-button" disabled={busy} onClick={() => onDecision('reject')}>Reject</button><button className="approve-button" disabled={busy} onClick={() => onDecision('approve')}>{busy ? 'Working…' : 'Approve'} <Icon size={15}><path d="m5 12 4 4L19 6"/></Icon></button></div>
  </div>
}

function Dashboard({ onOpenAgent, onSelectPage }: { onOpenAgent: () => void; onSelectPage: (page: Page) => void }) {
  return <>
    <div className="page-heading"><div><span className="eyebrow">WORKSPACE OVERVIEW</span><h1>Clinic overview</h1><p>A calm place to start, with your Agent one click away.</p></div><span className="page-badge"><span/> PETCLINIC WORKSPACE</span></div>

    <section className="hero">
      <div className="hero-copy"><span className="hero-kicker">INTRODUCING YOUR COPILOT</span><h2>Focus on care.<br /><em>Let the details flow.</em></h2><p>Find pet and appointment information in one conversation. When a change is requested, you stay in control.</p><button onClick={onOpenAgent}>Open PetClinic Agent <Icon size={18}><path d="m5 12h14m-6-6 6 6-6 6"/></Icon></button></div>
      <div className="hero-flow" aria-label="Agent workflow"><div className="flow-heading"><span className="flow-brand">✳</span><span>HOW IT WORKS</span></div><div className="flow-step"><span className="flow-number">01</span><div><strong>Ask a question</strong><small>Pets and appointments, in plain language.</small></div></div><div className="flow-step"><span className="flow-number">02</span><div><strong>See the work</strong><small>Follow the Agent’s activity as it checks details.</small></div></div><div className="flow-step"><span className="flow-number">03</span><div><strong>Approve changes</strong><small>You decide before an appointment is changed.</small></div></div></div>
    </section>

    <div className="section-heading"><div><h2>Explore your workspace</h2><p>Go to a section or ask the Agent to help with a specific record.</p></div></div>
    <div className="workspace-grid">
      {navigation.filter(item => item.label !== 'Dashboard').map(item => <button className="workspace-card" key={item.label} onClick={() => onSelectPage(item.label)}><span className="workspace-card-icon"><Icon size={22}>{item.icon}</Icon></span><span className="workspace-card-copy"><strong>{item.label}</strong><small>{item.description}</small></span><Icon size={18}><path d="m5 12h14m-6-6 6 6-6 6"/></Icon></button>)}
    </div>

    <section className="info-panel"><div className="info-icon"><Icon size={22}><path d="M12 3 3 7v5c0 5 3.5 8 9 9 5.5-1 9-4 9-9V7l-9-4Z"/><path d="m9 12 2 2 4-4"/></Icon></div><div><strong>Built for decisions that matter</strong><p>PetClinic Agent can look up information and prepare an appointment change. The final decision is always yours.</p></div></section>
  </>
}

function SectionPlaceholder({ page, onOpenAgent }: { page: Page; onOpenAgent: () => void }) {
  const item = navigation.find(entry => entry.label === page)!
  return <><div className="page-heading"><div><span className="eyebrow">WORKSPACE</span><h1>{page}</h1><p>{item.description}</p></div></div><div className="section-placeholder"><span className="placeholder-icon"><Icon size={28}>{item.icon}</Icon></span><span className="placeholder-eyebrow">COMING NEXT</span><h2>{page} workspace</h2><p>This section is being built. For now, the Agent can help you look up PetClinic records and review appointment changes.</p><button onClick={onOpenAgent}>Ask PetClinic Agent <Icon size={17}><path d="m5 12h14m-6-6 6 6-6 6"/></Icon></button></div></>
}

export default App
