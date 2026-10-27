import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';

export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </header>
  );
}

const ALERT_ICONS = { info: Info, warn: AlertTriangle, error: XCircle, success: CheckCircle2 };

export function Alert({ kind = 'info', children }) {
  const Icon = ALERT_ICONS[kind];
  return (
    <div className={`alert alert-${kind}`}>
      <Icon size={16} />
      <div>{children}</div>
    </div>
  );
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Spinner({ size = 14 }) {
  return <Loader2 size={size} className="spin" />;
}

export function Switch({ checked, onChange, label, hint }) {
  return (
    <label className="switch-row">
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track"><span className="switch-thumb" /></span>
      </span>
      <span>
        <span className="switch-label">{label}</span>
        {hint && <span className="switch-hint">{hint}</span>}
      </span>
    </label>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, label }) {
  return (
    <div className="progress">
      <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} /></div>
      {label && <span className="progress-label">{label}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
