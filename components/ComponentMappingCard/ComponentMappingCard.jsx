function ComponentMappingCard({ title, items, id }) {
  const ExpandableCard = window.ExpandableCard;
  const PlatformRow = window.PlatformRow;

  return (
    <ExpandableCard title={title} id={id}>
      <div className="platform-table">

        {/* Header Row */}
        <div className="platform-header">
          <div className="platform-cell master">Component</div>
          <div className="platform-cell">Android</div>
          <div className="platform-cell">iOS</div>
          <div className="platform-cell">React Native</div>
          <div className="platform-cell">Flutter</div>
          <div className="platform-cell">Xamarin</div>
          <div className="platform-cell">Ionic</div>
        </div>

        {items.map((item, idx) => (
          <PlatformRow key={idx} {...item} />
        ))}
      </div>
    </ExpandableCard>
  );
}

// expose as global so HTML scripts can access
window.ComponentMappingCard = ComponentMappingCard;
