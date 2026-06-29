import { Link, useLocation, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { cloudImageMapper, getCloudName, integrationsList } from "../../../helpers/helpers";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import BlogFooter from "../BlogReusables/BlogFooter";
import BlogTopNav from "../BlogReusables/BlogTopNav";
import BlogPostContentEditor from "./BlogPostContentEditor";
import ContentJSON from "../BlogReusables/ContentJSON.json";
const INTEGRATION_CATEGORY_LABELS = {
    BUSINESS: "PRODUCTIVITY",
    IDENTITY: "IDENTITY",
    CLOUD: "CLOUD",
    DATA: "DATA",
    IT_SERVICE: "IT SERVICE",
    CRM: "CRM",
    CMS: "CMS",
};

const NewPost = () => {
    const location = useLocation();
    const [searchTerm, setSearchTerm] = useState("");
    const posterContentRef = useRef(null);
    const { postId } = useParams();


    useEffect(() => {
        const el = posterContentRef.current;
        if (!el) return;
        const links = el.querySelectorAll("a[href]");
        links.forEach((a) => {
            a.setAttribute("target", "_blank");
            a.setAttribute("rel", "noopener noreferrer");
        });
    }, []);

    useEffect(() => {
        const el = posterContentRef.current;
        if (!el) return;
        const imgs = el.querySelectorAll("img");
        imgs.forEach((img) => {
            img.classList.add("cf_blog_img_loading");
            const onLoad = () => {
                img.classList.remove("cf_blog_img_loading");
                img.removeEventListener("load", onLoad);
                img.removeEventListener("error", onError);
            };
            const onError = () => {
                img.classList.remove("cf_blog_img_loading");
                img.removeEventListener("load", onLoad);
                img.removeEventListener("error", onError);
            };
            if (img.complete) onLoad();
            else {
                img.addEventListener("load", onLoad);
                img.addEventListener("error", onError);
            }
        });
    }, [postId]);

    const groupedIntegrations = useMemo(() => {
        const list = integrationsList() || [];
        const filtered = searchTerm.trim()
            ? list.filter((data) =>
                getCloudName(data?.cloudName)?.toLowerCase().includes(searchTerm.toLowerCase())
            )
            : list.slice(0, 110);
        return filtered.reduce((acc, data, index) => {
            const category = data?.category || "BUSINESS";
            const label = INTEGRATION_CATEGORY_LABELS[category] || category;
            if (!acc[label]) acc[label] = [];
            acc[label].push({ ...data, index });
            return acc;
        }, {});
    }, [searchTerm]);

    return (
        <div className="cf_blog_container">
            <BlogTopNav />
            <div className="cf_blog_content_container">
                <div className="cf_blog_hero_section" />
                <div className="cf_blog_new_post_container">
                    <div className="cf_blog_post_sideNav">
                        <div className="cf_blog_post_sideNav_search">
                            <SearchComponent
                                autoFocus={false}
                                autoOpen={true}
                                inputName="searchInput"
                                inputPlaceHolder="Search integrations..."
                                onInputSearch={(e) => setSearchTerm(e?.searchInput ?? "")}
                                customStyles={{ width: "100%" }}
                            />
                        </div>
                        <div className="cf_blog_post_blog_menu_items">
                            {Object.entries(groupedIntegrations).map(([categoryLabel, items]) => (
                                // <div key={categoryLabel} className="cf_blog_post_blog_menu_category_wrapper">
                                //     <div className="cf_blog_post_blog_menu_category">
                                //         {categoryLabel}
                                //     </div>
                                <>
                                    {Object.keys(ContentJSON).map((data) => (
                                        <Link
                                            to={`/blog/post/${data}`}
                                            key={data}
                                            className={`cf_blog_post_blog_menu_item_link ${postId === `${data}` ? "cf_blog_post_blog_menu_item_link_active" : ""}`}
                                        >
                                            <div className="cf_blog_post_blog_menu_item">
                                                <span className="cf_blog_post_blog_menu_item_icon">
                                                    <img
                                                        src={cloudImageMapper(data)}
                                                        alt=""
                                                        onError={(e) => { e.target.style.display = "none"; }}
                                                    />
                                                </span>
                                                <span className="cf_blog_post_blog_menu_item_label">
                                                    {getCloudName(data)}
                                                </span>
                                            </div>
                                        </Link>
                                    ))}
                                </>
                                // </div>
                            ))}
                        </div>
                    </div>
                    <div className="cf_blog_post_content_container">
                        <div className="cf_blog_poster">
                            <div className="cf_blog_poster_header">
                                <div className="cf_blog_poster_icon_circle">
                                    <img src={cloudImageMapper(postId)} alt="" />
                                </div>
                                <div className="cf_blog_poster_header_content">
                                    <h2 className="cf_blog_poster_title">{getCloudName(postId)} Integration Guide</h2>
                                </div>
                            </div>
                            {/* <BlogPostContentEditor /> */}
                            <div
                                ref={posterContentRef}
                                className="cf_blog_poster_content"
                                dangerouslySetInnerHTML={{
                                    __html: ContentJSON[postId] ?? ""
                                }}
                            ></div>
                        </div>
                    </div>
                </div>
            </div>
            <BlogFooter />
        </div>
    );
};

export default NewPost;