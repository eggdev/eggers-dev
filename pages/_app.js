import React, { useEffect } from "react";
import { ThemeProvider, makeStyles } from "@material-ui/core/styles";
import Box from "@material-ui/core/Box";
import CssBaseline from "@material-ui/core/CssBaseline";
import useDarkMode from "../hooks/useDarkMode";
import SpeedDial from "../components/SpeedDial/SpeedDial";

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

export default function MyApp({ Component, pageProps }) {
  useEffect(() => {
    const jssStyles = document.getElementById("jss-server-side");
    if (jssStyles) {
      jssStyles.parentElement.removeChild(jssStyles);
    }
  }, []);

  const { applicationContainer } = useStyles();
  const { muiTheme, isDarkMode, toggleDarkMode } = useDarkMode();

  return (
    <>
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        <Box className={applicationContainer}>
          <Component {...pageProps} />
          <SpeedDial isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
        </Box>
      </ThemeProvider>
    </>
  );
}
