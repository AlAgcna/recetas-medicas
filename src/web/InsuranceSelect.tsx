import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { insuranceKey, insuranceOptions } from '../shared/insurance';

const options = [...insuranceOptions.map(label => ({ value: label, label })), { value: '__other__', label: 'Otra' }];

export function InsuranceSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const matches = options.filter(option => option.value !== '__other__' && insuranceKey(option.label).includes(insuranceKey(query)));
  // «Otra» sigue disponible aunque la búsqueda no coincida con el catálogo.
  const filtered = [...matches, options[options.length - 1]];
  const selected = options.find(option => option.value === value)?.label ?? 'Otra';
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${highlighted}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlighted, id, query]);

  function choose(next: string) {
    onChange(next); setOpen(false); setQuery(''); setHighlighted(0);
  }

  return <div className="form-field insurance-select" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(''); }
  }}>
    <label htmlFor={id}>Obra social</label>
    <div className="insurance-control">
    <div className="insurance-combobox">
      <Search size={19} aria-hidden="true" />
      <input ref={input} id={id} role="combobox" aria-expanded={open} aria-autocomplete="list"
        aria-controls={`${id}-options`} aria-activedescendant={open ? `${id}-option-${highlighted}` : undefined}
        aria-describedby={`${id}-help`} autoComplete="off" spellCheck={false}
        value={open ? query : selected} placeholder={open ? 'Buscar obra social…' : 'Elegí una cobertura'}
        onFocus={() => { setOpen(true); setQuery(''); setHighlighted(0); }}
        onClick={() => { if (!open) { setOpen(true); setQuery(''); setHighlighted(0); } }}
        onChange={event => { setQuery(event.target.value); setOpen(true); setHighlighted(0); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setQuery(''); return; }
          if (event.key === 'Tab') { setOpen(false); setQuery(''); return; }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) { setOpen(true); setQuery(''); setHighlighted(0); }
            else setHighlighted(index => (index + (event.key === 'ArrowDown' ? 1 : filtered.length - 1)) % filtered.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (open) choose(filtered[highlighted]?.value ?? '__other__');
            else { setOpen(true); setQuery(''); setHighlighted(0); }
          } else if (open && (event.key === 'Home' || event.key === 'End')) {
            event.preventDefault(); setHighlighted(event.key === 'Home' ? 0 : filtered.length - 1);
          }
        }} />
      <button type="button" tabIndex={-1} aria-label="Mostrar obras sociales" onMouseDown={event => event.preventDefault()} onClick={() => {
        const next = !open;
        input.current?.focus(); setOpen(next); setQuery(''); setHighlighted(0);
      }}><ChevronDown size={20} /></button>
    </div>
    {open && <div className="insurance-options-panel">
      {!matches.length && <p className="insurance-no-results" role="status">No encontramos esa cobertura. Podés elegir «Otra».</p>}
      <ul id={`${id}-options`} role="listbox" aria-label="Obras sociales">{filtered.map((option, index) => <li
        id={`${id}-option-${index}`} key={option.value} role="option" aria-selected={option.value === value}
        className={index === highlighted ? 'highlighted' : ''} onMouseDown={event => event.preventDefault()}
        onMouseEnter={() => setHighlighted(index)} onClick={() => choose(option.value)}>
        <span>{option.label}</span>{option.value === value && <Check size={17} aria-hidden="true" />}
      </li>)}</ul>
    </div>}
    </div>
    <small id={`${id}-help`}>Buscá y elegí una opción. Si no figura, seleccioná «Otra».</small>
  </div>;
}
