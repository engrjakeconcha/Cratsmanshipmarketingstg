export function PasswordForm({
  error,
}: {
  error?: string;
}) {
  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="brand-lockup">
          <div className="brand-badge">CM</div>
          <div>
            <h1>Craftsmanship Marketing</h1>
          </div>
        </div>
        <form className="login-form" action="/api/auth" method="post">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter dashboard password"
            required
          />
          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit">Open dashboard</button>
        </form>
      </div>
    </main>
  );
}
