import React, { useState } from "react";
import { makeStyles, useTheme } from "@material-ui/core/styles";
import Card from "@material-ui/core/Card";
import Grid from "@material-ui/core/Grid";
import CardHeader from "@material-ui/core/CardHeader";
import CardMedia from "@material-ui/core/CardMedia";
import CardActions from "@material-ui/core/CardActions";
import Button from "@material-ui/core/Button";
import IconButton from "@material-ui/core/IconButton";
import Typography from "@material-ui/core/Typography";
import useMediaQuery from "@material-ui/core/useMediaQuery";
import Language from "@material-ui/icons/Language";
import GitHub from "@material-ui/icons/GitHub";
import Battery80Icon from "@material-ui/icons/Battery80";
import Info from "@material-ui/icons/Info";
import Grow from "@material-ui/core/Grow";
import Fade from "@material-ui/core/Fade";
import BrowserButtons from "../BrowserButtons/BrowserButtons";
import Moment from "react-moment";

const useStyles = makeStyles((theme) => ({
  mobileCard: {
    [theme.breakpoints.down("sm")]: {
      borderRadius: 20,
    },
  },
  batteryIcon: {
    transform: "rotate(90deg)",
  },
  avatar: {
    marginRight: 0,
    width: 50,
    padding: `0 ${theme.spacing(1)}px`,
  },
  action: {
    width: 50,
    margin: `${theme.spacing(0.5)}px 0`,
    [theme.breakpoints.down("sm")]: {
      margin: "0",
    },
  },
  subheader: {
    color: theme.palette.getContrastText(theme.palette.grey[700]),
    [theme.breakpoints.down("sm")]: {
      background: theme.palette.grey[800],
      position: "absolute",
      bottom: theme.spacing(-3),
      width: "100vw",
      padding: `${theme.spacing(0.25)}px`,
    },
  },
  content: {
    margin: `${theme.spacing(0.5)}px ${theme.spacing(3)}px`,
    borderRadius: 25,
    background: theme.palette.grey[700],
    position: "relative",
    display: "flex",
    justifyContent: "center",
    [theme.breakpoints.down("sm")]: {
      borderRadius: `0 0 20px 20px`,
      margin: `0 ${theme.spacing(1)}px`,
      padding: `${theme.spacing(1.5)}px 0`,
      background: theme.palette.common.black,
    },
  },
  cardHeader: {
    padding: 0,
    textAlign: "center",
    color: theme.palette.getContrastText(theme.palette.grey[800]),
    background: theme.palette.grey[800],
  },
  cardMedia: {
    margin: `0 auto`,
    backgroundPosition: "center top",
    backgroundSize: "cover",
    height: 225,
    [theme.breakpoints.down("sm")]: {
      marginTop: theme.spacing(3),
      height: 400,
    },
  },
  cardButton: {
    marginLeft: theme.spacing(1),
  },
  rightButton: {
    marginLeft: "auto",
    padding: theme.spacing(1),
  },
}));
const PortfolioItem = ({ data, openProjectDialog, index }) => {
  const [imageRender, setImageRender] = useState(false);
  const theme = useTheme();
  const desktopDevice = useMediaQuery(theme.breakpoints.up("md"));

  const {
    cardHeader,
    cardMedia,
    avatar,
    action,
    content,
    subheader,
    cardButton,
    rightButton,
    mobileCard,
    batteryIcon,
  } = useStyles();

  const {
    desktop_image,
    mobile_image,
    title,
    year_built,
    github,
    web_url,
  } = data;

  const handleOpenProject = () => {
    openProjectDialog(data);
  };
  const imgUrl = desktopDevice ? desktop_image : mobile_image;

  setTimeout(() => {
    setImageRender(true);
  }, (index + 1) * 100);

  return (
    <Grow in={true} timeout={desktopDevice ? (index + 1) * 400 : 0}>
      <Grid item xs={12} sm={6} lg={4}>
        <Card className={mobileCard}>
          {desktopDevice ? (
            <CardHeader
              avatar={<BrowserButtons />}
              action={
                <Typography variant="body2">
                  <Moment format="YYYY">{year_built}</Moment>
                </Typography>
              }
              classes={{
                avatar,
                action,
                content,
                subheader,
              }}
              className={cardHeader}
              subheader={title.toLowerCase()}
            />
          ) : (
            <CardHeader
              avatar={
                <Typography variant="body2">
                  <Moment format="YYYY">{year_built}</Moment>
                </Typography>
              }
              action={
                <Battery80Icon fontSize="small" className={batteryIcon} />
              }
              classes={{
                avatar,
                action,
                content,
                subheader,
              }}
              className={cardHeader}
              subheader={title.toLowerCase()}
            />
          )}
          <Fade in={imageRender} timeout={500}>
            <CardMedia
              component={"img"}
              className={cardMedia}
              title={title}
              alt={title}
              image={imgUrl}
            />
          </Fade>
          <CardActions disableSpacing>
            {web_url && (
              <Button
                size="small"
                variant="contained"
                href={web_url}
                target="_blank"
                rel="noopener noreferrer"
                className={cardButton}
                startIcon={<Language />}
              >
                Web
              </Button>
            )}
            {github.length < 1 ? (
              <Button
                className={cardButton}
                variant="contained"
                size="small"
                startIcon={<GitHub />}
                disabled
              >
                Private
              </Button>
            ) : (
              github.map((link, index) => (
                <Button
                  key={`${index}_link`}
                  size="small"
                  variant="contained"
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cardButton}
                  startIcon={<GitHub />}
                >
                  {desktopDevice
                    ? link.stack_type.replace(/_/g, " ")
                    : `${link.stack_type
                        .split("_")[0]
                        .charAt(0)}${link.stack_type.split("_")[1].charAt(0)}`}
                </Button>
              ))
            )}
            <IconButton className={rightButton} onClick={handleOpenProject}>
              <Info />
            </IconButton>
          </CardActions>
        </Card>
      </Grid>
    </Grow>
  );
};

export default PortfolioItem;
