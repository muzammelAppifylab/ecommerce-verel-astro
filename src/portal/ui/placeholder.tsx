import type {ReactNode} from 'react';

import {Card, PageHeader} from './display';
import {Icon} from './icon';

/**
 * A screen's body while it is being built (VAREL `AdminPlaceholder`): its
 * head and one card saying so. Every admin area starts as one of these
 * (`src/portal/screens/<area>/index.tsx`) until its package fills it.
 */
export function ScreenPlaceholder({title, description, children}: {title: ReactNode; description?: ReactNode; children?: ReactNode}) {
  return (
    <div className="app-page screen-placeholder">
      <PageHeader title={title} description={description} />
      <Card>
        <div className="placeholder-body">
          <span className="placeholder-icon">
            <Icon name="clock" size={18} />
          </span>
          <p>This section is being built.</p>
          {children}
        </div>
      </Card>
    </div>
  );
}
