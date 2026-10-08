import { Children, isValidElement, type ReactNode } from 'react'
import { CodeHighlighter } from '@ant-design/x'
import { XMarkdown, type ComponentProps } from '@ant-design/x-markdown'

function textContent(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      return isValidElement<{ children?: ReactNode }>(child)
        ? textContent(child.props.children)
        : ''
    })
    .join('')
}

function MarkdownCode({ children, block, lang }: ComponentProps) {
  if (!block) return <code>{children}</code>
  return (
    <CodeHighlighter lang={lang?.split(/\s/)[0]} prismLightMode={false}>
      {textContent(children).replace(/\n$/, '')}
    </CodeHighlighter>
  )
}

function MarkdownPre({ children }: ComponentProps) {
  return <>{children}</>
}
function MarkdownTable({ children }: ComponentProps) {
  return (
    <div className="markdown-table-scroll">
      <table>{children}</table>
    </div>
  )
}
function MarkdownLink({ children, href }: ComponentProps) {
  const url = typeof href === 'string' && /^https?:\/\//i.test(href) ? href : undefined
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  )
}
function MarkdownImage({ alt }: ComponentProps) {
  return <span className="markdown-image-alt">{typeof alt === 'string' ? alt : '图片'}</span>
}

const components = {
  code: MarkdownCode,
  pre: MarkdownPre,
  table: MarkdownTable,
  a: MarkdownLink,
  img: MarkdownImage
}

export default function MarkdownContent({
  content,
  streaming = false
}: {
  content: string
  streaming?: boolean
}) {
  return (
    <XMarkdown
      className="answer-markdown"
      content={content}
      components={components}
      escapeRawHtml
      dompurifyConfig={{
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'input', 'form']
      }}
      disableDefaultStyles={['pre', 'code', 'table', 'th', 'td']}
      streaming={{ hasNextChunk: streaming, tail: streaming }}
    />
  )
}
