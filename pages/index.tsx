// pages/index.tsx
import React, { useState, useRef, useEffect } from 'react'
import Head from 'next/head'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import styles from '../styles/Chat.module.css'

type Segment = { content: string; isThink: boolean }

// 1) Split out <think>…</think> segments
function splitThinkBlocks(md: string): Segment[] {
  const parts: Segment[] = []
  const regex = /<think>([\s\S]*?)<\/think>/gi
  let last = 0, m: RegExpExecArray | null
  while ((m = regex.exec(md))) {
    if (m.index > last) {
      parts.push({ content: md.slice(last, m.index), isThink: false })
    }
    parts.push({ content: m[1], isThink: true })
    last = m.index + m[0].length
  }
  if (last < md.length) {
    parts.push({ content: md.slice(last), isThink: false })
  }
  return parts
}

// 2) Only update renderedContent when code fences & $$…$$ are balanced
function isBalanced(md: string): boolean {
  const fences = (md.match(/```/g) || []).length
  const math   = (md.match(/\$\$/g)  || []).length
  return fences % 2 === 0 && math % 2 === 0
}

// 3) Collapsible “chain of thought”
function CollapsibleThink({ content }: { content: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ margin: '0.5rem 0' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#555',
          cursor: 'pointer',
          fontSize: '0.9rem',
          textDecoration: 'underline',
          padding: 0,
        }}
      >
        {open ? 'Hide reasoning ▲' : 'Show reasoning ▼'}
      </button>
      {open && (
        <div
          style={{
            background: '#f9f9f9',
            borderLeft: '3px solid #aaa',
            padding: '0.5rem 1rem',
            marginTop: '0.5rem',
          }}
        >
          <ReactMarkdown
            children={content}
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex, rehypeHighlight]}
            components={{ code: CodeBlock }}
          />
        </div>
      )}
    </div>
  )
}

// 4) Code block renderer with copy button
function CodeBlock({ inline, className, children, ...props }: any) {
  const code = String(children).replace(/\n$/, '')
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  return (
    <div style={{ position: 'relative' }}>
      <pre className={className} {...props}>
        <code>{code}</code>
      </pre>
      <button
        onClick={handleCopy}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          fontSize: '0.9em',
          background: copied ? '#a21caf' : '#eee',
          color: copied ? '#fff' : '#333',
          border: 'none',
          borderRadius: 4,
          padding: '2px 8px',
          cursor: 'pointer',
          zIndex: 2,
          transition: 'background 0.2s, color 0.2s',
        }}
        aria-label="Copy code"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

type Message = { role: 'user' | 'assistant'; content: string }

export default function Home() {
  const [messages, setMessages]       = useState<Message[]>([])
  const [input, setInput]             = useState('')
  const [loading, setLoading]         = useState(false)
  // Streaming buffers for the last assistant
  const [fullContent, setFullContent]       = useState('')
  const [renderedContent, setRenderedContent] = useState('')

  const bottomRef    = useRef<HTMLDivElement>(null)
  const textareaRef  = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, renderedContent])

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    setInput(e.currentTarget.value)
    const t = textareaRef.current!
    t.style.height = 'auto'
    t.style.height = t.scrollHeight + 'px'
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  async function sendMessage() {
    if (!input.trim()) return
    const userMsg: Message = { role: 'user', content: input }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setInput('')
    setLoading(true)
    // Reserve spot for assistant
    setMessages(m => [...m, { role: 'assistant', content: '' }])
    setFullContent('')
    setRenderedContent('')

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: updated }),
    })
    if (!res.body) return setLoading(false)

    const reader = res.body.getReader()
    const dec    = new TextDecoder()
    let buf = '', done = false

    while (!done) {
      const { value, done: rDone } = await reader.read()
      done = rDone
      if (value) {
        buf += dec.decode(value, { stream: true })
        const lines = buf.split(/\r?\n/)
        buf = lines.pop()!
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.replace(/^data:\s*/, '')
          if (payload === '[DONE]') { done = true; break }
          const { delta, error } = JSON.parse(payload)
          if (error) {
            setMessages(m => {
              const c = [...m]
              c[c.length - 1].content = error
              return c
            })
            done = true
            break
          }
          // 1) update buffers
          setFullContent(prev => {
            const u = prev + delta
            if (isBalanced(u)) setRenderedContent(u)
            return u
          })
          // 2) append to history
          setMessages(m => {
            const c = [...m]
            c[c.length - 1].content += delta
            return c
          })
        }
      }
    }
    // on finish, flush any remaining balanced content
    setRenderedContent(prev =>
      fullContent && isBalanced(fullContent) ? fullContent : prev
    )
    setLoading(false)
  }

  return (
    <>
      <Head>
        <title>LumiChat</title>
        <meta name="description" content="Illuminate your conversations" />
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Cdefs%3E%3ClinearGradient%20id='g'%20x1='0%25'%20y1='0%25'%20x2='100%25'%20y2='0%25'%3E%3Cstop%20offset='0%25'%20stop-color='%237e22ce'/%3E%3Cstop%20offset='100%25'%20stop-color='%23a21caf'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle%20cx='50'%20cy='50'%20r='45'%20fill='url(%23g)'/%3E%3Cpath%20d='M30%2040%20h40%20v20%20h-10%20l-5%2010%20-5-10%20h-20%20z'%20fill='white'/%3E%3C/svg%3E"
        />
      </Head>
      <header className={styles.header}>LumiChat</header>
      <main className={styles.main}>
        <div className={styles.chatContainer}>
          <div className={styles.messages}>
            {messages.map((m, i) => {
              const isLastAI = i === messages.length - 1 && m.role === 'assistant'
              // Choose which content to render
              const content = isLastAI ? renderedContent : m.content
              const segments = splitThinkBlocks(content)

              return (
                <div
                  key={i}
                  className={`${styles.messageRow} ${
                    m.role === 'user' ? styles.userRow : styles.assistantRow
                  }`}
                >
                  <div className={styles.avatar}>
                    {m.role === 'user' ? 'Y' : 'L'}
                  </div>
                  <div
                    className={`${styles.bubble} ${
                      m.role === 'user'
                        ? styles.userBubble
                        : styles.assistantBubble
                    }`}
                  >
                    {segments.map((seg, j) =>
                      seg.isThink ? (
                        <CollapsibleThink key={j} content={seg.content} />
                      ) : (
                        <ReactMarkdown
                          key={j}
                          children={seg.content}
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex, rehypeHighlight]}
                          components={{ code: CodeBlock }}
                        />
                      )
                    )}
                    {isLastAI && fullContent !== renderedContent && (
                      <pre className={styles.rawTail}>
                        {fullContent.slice(renderedContent.length)}
                      </pre>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
          <div className={styles.inputContainer}>
            <textarea
              ref={textareaRef}
              className={styles.textInput}
              value={input}
              onInput={onInput}
              onKeyDown={onKeyDown}
              placeholder="Type a message…"
              rows={1}
              disabled={loading}
            />
            <button
              className={styles.sendButton}
              onClick={sendMessage}
              disabled={loading}
            >
              {loading ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </main>
    </>
  )
}