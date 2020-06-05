import React from "react";
import { ThemeProvider } from "@material-ui/core/styles";
import { CssBaseline, Box } from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import { BrowserRouter as Router } from "react-router-dom";
import AppRoutes from "./routes/AppRoutes";
import DarkModeToggle from "./components/DarkModeToggle/DarkModeToggle";
import useDarkMode from "./hooks/useDarkMode";

const useStyles = makeStyles((theme) => ({
  applicationContainer: {
    position: "relative",
    minHeight: "100vh",
    minWidth: "100vw",
    maxWidth: "100vw",
    overflowX: "hidden",
    overflowY: "hidden",
  },
}));

const Root = () => {
  const classes = useStyles();
  const { muiTheme, isDarkMode, toggleDarkMode } = useDarkMode();
  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <DarkModeToggle isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
      <Box className={classes.applicationContainer}>
        <Router>
          <AppRoutes />
        </Router>
      </Box>
    </ThemeProvider>
  );
};

export default Root;
