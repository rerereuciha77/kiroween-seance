interface Props {
  body: string
  subject?: string
}

/** Plain-text body pane used for Finger output and Usenet articles. */
export default function FingerOutput({ body, subject }: Props) {
  return (
    <>
      {subject ? <p className="section-label">{subject}</p> : null}
      <pre className="body">{body?.trim() ? body : '(empty response)'}</pre>
    </>
  )
}