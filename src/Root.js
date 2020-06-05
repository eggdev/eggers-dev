import React from "react";
import { ThemeProvider } from "@material-ui/core/styles";
import Box from "@material-ui/core/Box";
import CssBaseline from "@material-ui/core/CssBaseline";
import { makeStyles } from "@material-ui/core/styles";
import { BrowserRouter as Router } from "react-router-dom";
import AppRoutes from "./routes/AppRoutes";
import SpeedDial from "./components/SpeedDial/SpeedDial";
import useDarkMode from "./hooks/useDarkMode";

const useStyles = makeStyles((theme) => ({
  applicationContainer: {
    position: "relative",
    minHeight: "100vh",
    minWidth: "100vw",
    maxWidth: "100vw",
    overflowX: "hidden",
    overflowY: "hidden",
    padding: theme.spacing(2),
  },
}));

const Root = () => {
  const classes = useStyles();
  const { muiTheme, isDarkMode, toggleDarkMode } = useDarkMode();
  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <Box className={classes.applicationContainer}>
        <Router>
          <AppRoutes />
          <SpeedDial isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
        </Router>
      </Box>
    </ThemeProvider>
  );
};

export default Root;
