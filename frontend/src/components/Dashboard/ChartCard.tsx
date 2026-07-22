import { MouseEvent as ReactMouseEvent, ReactNode, useState } from 'react';
import { Box, Dialog, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Tooltip, Typography } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import CloseIcon from '@mui/icons-material/Close';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { downloadChartPng } from '../../utils/chartExport';
import { exportRowsToCsv } from '../../utils/tableExport';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  chartId: string;
  height?: number;
  sortDirection?: 'asc' | 'desc';
  onSortAsc?: () => void;
  onSortDesc?: () => void;
  sortAscLabel?: string;
  sortDescLabel?: string;
  csvHeaders: string[];
  csvRows: Array<Array<string | number>>;
  fileBaseName: string;
  children: (height: number) => ReactNode;
}

const ChartCard = ({
  title,
  subtitle,
  chartId,
  height = 240,
  sortDirection,
  onSortAsc,
  onSortDesc,
  sortAscLabel = 'Ordenar ascendente',
  sortDescLabel = 'Ordenar descendente',
  csvHeaders,
  csvRows,
  fileBaseName,
  children
}: ChartCardProps) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const handleOpenMenu = (event: ReactMouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleCloseMenu = () => setAnchorEl(null);

  const activeChartId = fullscreen ? `${chartId}-full` : chartId;

  const handleDownloadPng = async () => {
    await downloadChartPng(activeChartId, `${fileBaseName}.png`);
    handleCloseMenu();
  };

  const handleDownloadCsv = () => {
    exportRowsToCsv(`${fileBaseName}.csv`, csvHeaders, csvRows);
    handleCloseMenu();
  };

  return (
    <Paper
      sx={{
        px: 2,
        py: 1.5,
        borderRadius: 2.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: '0 10px 26px rgba(15, 23, 42, 0.06)',
        transition: 'box-shadow 220ms ease, border-color 220ms ease',
        '&:hover': { boxShadow: '0 14px 32px rgba(15, 23, 42, 0.1)' }
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1, minHeight: 30 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography sx={{ fontSize: 10.5, color: 'text.secondary', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <Tooltip title="Opciones del gráfico">
          <IconButton
            size="small"
            onClick={handleOpenMenu}
            sx={{ width: 26, height: 26, border: '1px solid', borderColor: 'divider', transition: 'all 200ms ease', '&:hover': { borderColor: '#E6007E' } }}
          >
            <MoreVertIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleCloseMenu} PaperProps={{ sx: { minWidth: 225, borderRadius: 2.5 } }}>
          {onSortAsc && (
            <MenuItem
              dense
              selected={sortDirection === 'asc'}
              onClick={() => {
                onSortAsc();
                handleCloseMenu();
              }}
            >
              <ListItemIcon>
                <ArrowUpwardIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primaryTypographyProps={{ fontSize: 13 }}>{sortAscLabel}</ListItemText>
            </MenuItem>
          )}
          {onSortDesc && (
            <MenuItem
              dense
              selected={sortDirection === 'desc'}
              onClick={() => {
                onSortDesc();
                handleCloseMenu();
              }}
            >
              <ListItemIcon>
                <ArrowDownwardIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primaryTypographyProps={{ fontSize: 13 }}>{sortDescLabel}</ListItemText>
            </MenuItem>
          )}
          {(onSortAsc || onSortDesc) && <Divider />}
          <MenuItem
            dense
            onClick={() => {
              setFullscreen(true);
              handleCloseMenu();
            }}
          >
            <ListItemIcon>
              <FullscreenIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: 13 }}>Pantalla completa</ListItemText>
          </MenuItem>
          <MenuItem dense onClick={handleDownloadPng}>
            <ListItemIcon>
              <ImageOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: 13 }}>Exportar PNG</ListItemText>
          </MenuItem>
          <MenuItem dense onClick={handleDownloadCsv}>
            <ListItemIcon>
              <DescriptionOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: 13 }}>Exportar CSV</ListItemText>
          </MenuItem>
        </Menu>
      </Box>
      <Box id={chartId} sx={{ width: '100%', height, flexGrow: 1, minHeight: 0 }}>
        {children(height)}
      </Box>

      <Dialog open={fullscreen} onClose={() => setFullscreen(false)} fullScreen>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="h6" fontWeight={700}>
            {title}
          </Typography>
          <IconButton onClick={() => setFullscreen(false)}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Box id={`${chartId}-full`} sx={{ width: '100%', height: 'calc(100vh - 88px)', p: 3 }}>
          {children(window.innerHeight ? window.innerHeight - 160 : 600)}
        </Box>
      </Dialog>
    </Paper>
  );
};

export default ChartCard;
