import { Box, Paper, Typography } from '@mui/material';

interface PlaceholderPageProps {
  title: string;
}

const PlaceholderPage = ({ title }: PlaceholderPageProps) => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '70vh' }}>
    <Paper sx={{ p: 6, width: '100%', maxWidth: 720, textAlign: 'center', boxShadow: 3 }}>
      <Typography variant="h4" gutterBottom>
        {title}
      </Typography>
      <Typography variant="h6" color="text.secondary">
        Próximamente
      </Typography>
    </Paper>
  </Box>
);

export default PlaceholderPage;
