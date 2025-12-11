function PlatformRow({
  master,
  android,
  ios,
  react,
  flutter,
  xamarin,
  ionic
}) {
  return (
    <div className="platform-row">
      <div className="platform-cell master">{master}</div>

      <div className="platform-cell">
        <a href={android.link} target="_blank">{android.name}</a>
      </div>

      <div className="platform-cell">
        <a href={ios.link} target="_blank">{ios.name}</a>
      </div>

      <div className="platform-cell">
        <a href={react.link} target="_blank">{react.name}</a>
      </div>

      <div className="platform-cell">
        <a href={flutter.link} target="_blank">{flutter.name}</a>
      </div>

      <div className="platform-cell">
        <a href={xamarin.link} target="_blank">{xamarin.name}</a>
      </div>

      <div className="platform-cell">
        <a href={ionic.link} target="_blank">{ionic.name}</a>
      </div>
    </div>
  );
}

// Expose globally so ComponentMappingCard can access it
window.PlatformRow = PlatformRow;
