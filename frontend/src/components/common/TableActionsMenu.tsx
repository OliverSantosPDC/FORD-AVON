import { MouseEvent as ReactMouseEvent, useState } from 'react';
import {
  Checkbox,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';

export interface TableActionsColumn {
  id: string;
  label: string;
}

interface TableActionsMenuProps {
  columns?: TableActionsColumn[];
  hiddenColumns?: string[];
  onToggleColumn?: (id: string) => void;
  onCopy?: () => void;
  onExportCsv?: () => void;
  onExportExcel?: () => void;
  onToggleSort?: () => void;
  sortLabel?: string;
}

const TableActionsMenu = ({
  columns = [],
  hiddenColumns = [],
  onToggleColumn,
  onCopy,
  onExportCsv,
  onExportExcel,
  onToggleSort,
  sortLabel
}: TableActionsMenuProps) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (event: ReactMouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const runAndClose = (action?: () => void) => {
    action?.();
    handleClose();
  };

  return (
    <>
      <Tooltip title="Opciones de tabla">
        <IconButton
          size="small"
          onClick={handleOpen}
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            transition: 'all 220ms ease-in-out',
            '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 10px 24px rgba(15, 23, 42, 0.1)' }
          }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={open} onClose={handleClose} PaperProps={{ sx: { minWidth: 240, borderRadius: 3 } }}>
        {onToggleSort && (
          <MenuItem onClick={() => runAndClose(onToggleSort)}>
            <ListItemIcon>
              <SwapVertIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{sortLabel ?? 'Invertir orden'}</ListItemText>
          </MenuItem>
        )}
        {onCopy && (
          <MenuItem onClick={() => runAndClose(onCopy)}>
            <ListItemIcon>
              <ContentCopyOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Copiar al portapapeles</ListItemText>
          </MenuItem>
        )}
        {onExportCsv && (
          <MenuItem onClick={() => runAndClose(onExportCsv)}>
            <ListItemIcon>
              <DescriptionOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Exportar CSV</ListItemText>
          </MenuItem>
        )}
        {onExportExcel && (
          <MenuItem onClick={() => runAndClose(onExportExcel)}>
            <ListItemIcon>
              <TableChartOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Exportar Excel</ListItemText>
          </MenuItem>
        )}
        {columns.length > 0 && onToggleColumn && (
          <>
            <Divider />
            <Typography variant="caption" sx={{ px: 2, py: 0.5, display: 'block', color: 'text.secondary' }}>
              Mostrar / ocultar columnas
            </Typography>
            {columns.map((column) => (
              <MenuItem key={column.id} dense onClick={() => onToggleColumn(column.id)}>
                <Checkbox size="small" checked={!hiddenColumns.includes(column.id)} sx={{ p: 0.5, mr: 1 }} />
                <ListItemText primary={column.label} />
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
    </>
  );
};

export default TableActionsMenu;
