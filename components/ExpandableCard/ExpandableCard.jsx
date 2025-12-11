function ExpandableCard({ title, children, id }) {
  const bodyRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);

  // Load pin state
  React.useEffect(() => {
    const saved = localStorage.getItem(`pin-${id}`);
    if (saved === "true") {
      setPinned(true);
      setOpen(true);
    }
  }, [id]);

  const toggle = () => {
    if (!pinned) setOpen((prev) => !prev);
  };

  const togglePin = (e) => {
    e.stopPropagation();
    const newPin = !pinned;
    setPinned(newPin);
    localStorage.setItem(`pin-${id}`, newPin);

    if (newPin) setOpen(true);
  };

  return ( <div className="ai-similarity-ui">
    <div className="expand-card">
      <div className="expand-card-header" onClick={toggle}>
        <h3 className="expand-card-title">{title}</h3>

        <div className="expand-card-actions">
          <button
            className={`pin-btn ${pinned ? "pinned" : ""}`}
            onClick={togglePin}
          >
            📌
          </button>

          <button className={`chevron ${open ? "rotated" : ""}`}>▼</button>
        </div>
      </div>

      <div
        ref={bodyRef}
        className={`expand-card-body ${open ? "open" : ""}`}
        style={{
          maxHeight: open
            ? `${bodyRef.current?.scrollHeight}px`
            : "0px"
        }}
      >
        {children}
      </div>
    </div>
    </div>
  );
}

// expose globally for HTML usage
window.ExpandableCard = ExpandableCard;
