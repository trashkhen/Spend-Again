import { Layout } from '../components/Layout'

export function Settings() {
  return (
    <Layout>
      <div className="dashboard-section">
        <h2 className="section-heading">Settings</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>
          Account settings and preferences coming soon.
        </p>
      </div>
    </Layout>
  )
}
