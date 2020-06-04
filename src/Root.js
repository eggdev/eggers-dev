import React from "react";
import { ThemeProvider } from "@material-ui/core/styles";
import { CssBaseline, Box } from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import { BrowserRouter as Router } from "react-router-dom";
import AppRoutes from "./routes/AppRoutes";
import AppNav from "./components/AppNav/AppNav";
import DarkModeToggle from "./components/DarkModeToggle/DarkModeToggle";
import useDarkMode from "./hooks/useDarkMode";

const useStyles = makeStyles((theme) => ({
  applicationContainer: {
    position: "relative",
    minHeight: "100vh",
    maxHeight: "100vh",
    minWidth: "100vw",
    maxWidth: "100vw",
    overflowX: "hidden",
    overflowY: "auto",
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
          <AppNav />
          <AppRoutes />
        </Router>
      </Box>
    </ThemeProvider>
  );
};

export default Root;
