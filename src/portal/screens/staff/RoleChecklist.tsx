import {Link} from '@tanstack/react-router';

import type {StaffRoleOption} from '../../../lib/types/admin/staff';
import {Badge, Checkbox} from '../../ui';
import {AREA_LABEL, accessSummary, areasOfRoles, checklistRoles, PERMISSION_AREAS} from './areas';

/** The areas a role (or a person) has, as chips; "Every area" for all of them (VAREL `AreaList`). */
export function AreaList({areas}: {areas: readonly string[]}) {
  if (areas.length >= PERMISSION_AREAS.length) return <span className="muted">Every area</span>;
  if (!areas.length) return <span className="muted">None</span>;
  return (
    <span className="badges">
      {areas.map(a => (
        <Badge key={a}>{AREA_LABEL[a as keyof typeof AREA_LABEL] ?? a}</Badge>
      ))}
    </span>
  );
}

/**
 * One checkbox per role that grants store areas (VAREL `AccessFields`: the Staff/Admin radio and the area boxes
 * become template roles). Roles the viewer cannot hand out are disabled; the server refuses them anyway.
 */
export function RoleChecklist({
  roles,
  value,
  onChange,
  error,
  disabled,
  id = 'staff-roles',
}: {
  roles: StaffRoleOption[];
  value: string[];
  onChange: (next: string[]) => void;
  error?: string | null;
  disabled?: boolean;
  id?: string;
}) {
  const options = checklistRoles(roles);
  const areas = areasOfRoles(value, roles);
  return (
    <fieldset className="checkbox-group staff-roles" id={id} aria-invalid={error ? true : undefined} aria-describedby={`${id}-summary${error ? ` ${id}-error` : ''}`}>
      <legend>Roles</legend>
      {options.map(role => (
        <div key={role.slug} className="staff-role" title={role.assignable ? undefined : 'You cannot give this role: it includes permissions you do not have'}>
          <Checkbox
            label={role.name}
            description={
              <>
                {role.description && <span className="staff-role-help">{role.description}</span>}
                <AreaList areas={role.areas} />
              </>
            }
            checked={value.includes(role.slug)}
            disabled={disabled || !role.assignable}
            onChange={checked => onChange(checked ? [...value, role.slug] : value.filter(s => s !== role.slug))}
          />
        </div>
      ))}
      {!options.length && <p className="muted">No role grants store access yet. Create one in Roles.</p>}
      <p className="staff-roles-summary" id={`${id}-summary`}>
        {accessSummary(areas)} Everyone with an area can see the dashboard.
      </p>
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      <p className="staff-roles-link">
        <Link to="/roles">Need a different mix of areas? Create a role</Link>
      </p>
    </fieldset>
  );
}
