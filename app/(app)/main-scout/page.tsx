export default function MainScoutPage() {
  return (
    <div className="classic-shell">
      <div className="classic-header card">
        <div>
          <h2>Main Scout App</h2>
          <p className="muted">Full Scout App feature set from the working v73 line, mounted inside the v8 login/cloud shell so dorking, OAuth, Gmail, replies, batch sending, verification, settings, timeline, and import remain available while native pages are migrated safely.</p>
        </div>
        <a className="btn secondary" href="/api/main-scout" target="_blank" rel="noreferrer">Open full screen</a>
      </div>
      <iframe
        title="Main Scout App"
        src="/api/main-scout"
        className="classic-frame"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads allow-modals allow-top-navigation-by-user-activation"
      />
    </div>
  );
}
