import { Link, useLocation, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { cloudImageMapper, getCloudName, integrationsList } from "../../../helpers/helpers";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import BlogFooter from "../BlogReusables/BlogFooter";
import BlogTopNav from "../BlogReusables/BlogTopNav";
import BlogPostContentEditor from "./BlogPostContentEditor";
import ContentJSON from "../BlogReusables/ContentJSON.json";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { Download } from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import CF_LOGO from "../../../../assets/images/CF_LOGO.png";
import { getBlogPost, listBlogPosts } from "../AssertManager/AssertAction";
const INTEGRATION_CATEGORY_LABELS = {
    BUSINESS: "PRODUCTIVITY",
    IDENTITY: "IDENTITY",
    CLOUD: "CLOUD",
    DATA: "DATA",
    IT_SERVICE: "IT SERVICE",
    CRM: "CRM",
    CMS: "CMS",
};

const BlogPost = () => {
    const location = useLocation();
    const [searchTerm, setSearchTerm] = useState("");
    const posterContentRef = useRef(null);
    const printContentRef = useRef(null);
    const { postId } = useParams();
    const [isLoading, setIsLoading] = useState(true);
    const [blogPosts, setBlogPosts] = useState([]);
    const [blogContent, setBlogContent] = useState("");
    // const [isLoadingBlog, setIsLoading] = useState(true);
    useEffect(() => {
        const fetchBlogPosts = async () => {
            const { status, res } = await listBlogPosts();
            if (status === "OK") {
                setBlogPosts(res ?? []);
                setIsLoading(false);
            } else {
                setIsLoading(false);
            }
        };
        fetchBlogPosts();
    }, []);


    useEffect(() => {
        const el = posterContentRef.current;
        if (!el) return;
        const links = el.querySelectorAll("a[href]");
        links.forEach((a) => {
            a.setAttribute("target", "_blank");
            a.setAttribute("rel", "noopener noreferrer");
        });
        if (postId) {
            setSearchTerm("");
            fetchBlog(postId);
        }
    }, [postId]);

    const fetchBlog = async (vendorName) => {
        setIsLoading(true);
        const { status, res } = await getBlogPost(vendorName);
        if (status === "OK") {
            setBlogContent(res ?? "");
            setIsLoading(false);
        } else {
            setIsLoading(false);
        }
    };

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


    const loadLogoAsDataUrl = () =>
        new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const c = document.createElement("canvas");
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext("2d");
                ctx.drawImage(img, 0, 0);
                resolve({
                    dataUrl: c.toDataURL("image/png"),
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                });
            };
            img.onerror = () => resolve(null);
            img.src = CF_LOGO;
        });

    const downloadPDF = async () => {
        setIsLoading(true);
        const input = printContentRef.current;
        if (!input) {
            setIsLoading(false);
            return;
        }

        const clone = input.cloneNode(true);
        const hideInPdf = clone.querySelectorAll(".cf_hide_in_pdf");
        hideInPdf.forEach((el) => el.remove());

        clone.style.display = "flex";
        clone.style.flexDirection = "column";
        clone.style.width = input.offsetWidth + "px";
        clone.style.padding = "0";
        clone.style.boxSizing = "border-box";

        const posterEl = clone.querySelector(".cf_blog_poster");
        if (posterEl) {
            posterEl.style.flex = "1";
            posterEl.style.minHeight = "0";
            posterEl.style.padding = "24px 28px 28px";
            posterEl.style.boxSizing = "border-box";
        }

        const container = document.createElement("div");
        container.style.cssText = "position:fixed; left:-9999px; top:0; width:" + input.offsetWidth + "px;";
        container.appendChild(clone);
        document.body.appendChild(container);

        const canvas = await html2canvas(clone, {
            scale: 2,
            useCORS: true,
        });

        document.body.removeChild(container);

        const imgData = canvas.toDataURL("image/png");
        const logoResult = await loadLogoAsDataUrl();

        const pdf = new jsPDF("p", "mm", "a4");
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();

        const marginLeft = 12;
        const marginTop = 10;
        const marginRight = 12;
        const logoWidthPx = 100;
        const logoWidthMm = (logoWidthPx / 96) * 25.4;
        const logoHeightMm =
            logoResult?.width && logoResult?.height
                ? logoWidthMm * (logoResult.height / logoResult.width)
                : 10;
        const lineY = marginTop + logoHeightMm + 4;
        const contentMarginTop = 6;
        const headerHeight = lineY + 1 + contentMarginTop;
        const contentAreaHeight = pdfHeight - headerHeight;

        const imgWidth = pdfWidth - marginLeft - marginRight;
        const imgHeightPdf = (canvas.height * imgWidth) / canvas.width;

        const addHeader = () => {
            if (logoResult?.dataUrl) {
                pdf.addImage(logoResult.dataUrl, "PNG", marginLeft, marginTop, logoWidthMm, logoHeightMm);
            }
            pdf.setDrawColor(226, 232, 240);
            pdf.setLineWidth(0.3);
            pdf.line(marginLeft, lineY, pdfWidth - marginRight, lineY);
        };

        const drawContentSlice = (sourceY, sourceHeightPx, destY) => {
            const sliceHeightMm = (sourceHeightPx / canvas.height) * imgHeightPdf;
            const sliceCanvas = document.createElement("canvas");
            sliceCanvas.width = canvas.width;
            sliceCanvas.height = sourceHeightPx;
            const ctx = sliceCanvas.getContext("2d");
            ctx.drawImage(
                canvas,
                0, sourceY, canvas.width, sourceHeightPx,
                0, 0, sliceCanvas.width, sliceCanvas.height
            );
            const sliceData = sliceCanvas.toDataURL("image/png");
            pdf.addImage(sliceData, "PNG", marginLeft, destY, imgWidth, sliceHeightMm);
        };

        let contentDrawn = 0;
        const contentTotalMm = imgHeightPdf;
        let pageNum = 0;

        addHeader();
        const firstSliceMm = Math.min(contentAreaHeight, contentTotalMm);
        const firstSlicePx = (firstSliceMm / contentTotalMm) * canvas.height;
        drawContentSlice(0, firstSlicePx, headerHeight);
        contentDrawn += firstSliceMm;

        while (contentDrawn < contentTotalMm) {
            pdf.addPage();
            pageNum++;
            addHeader();
            const sliceMm = Math.min(contentAreaHeight, contentTotalMm - contentDrawn);
            const sourceY = (contentDrawn / contentTotalMm) * canvas.height;
            const sourceHeight = (sliceMm / contentTotalMm) * canvas.height;
            drawContentSlice(sourceY, sourceHeight, headerHeight);
            contentDrawn += sliceMm;
        }

        pdf.save(getCloudName(postId || "ACTIVECAMPAIGN") + "-integration-guide.pdf");
        setIsLoading(false);
    };


    return (
        <>
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
                                    defaultVal={searchTerm}
                                    inputPlaceHolder="Search integrations..."
                                    onInputSearch={(e) => setSearchTerm(e?.searchInput ?? "")}
                                    customStyles={{ width: "100%" }}
                                />
                            </div>
                            <div className="cf_blog_post_blog_menu_items">
                                {Object.entries(groupedIntegrations)?.map(([categoryLabel, items]) => (
                                    // <div key={categoryLabel} className="cf_blog_post_blog_menu_category_wrapper">
                                    //     <div className="cf_blog_post_blog_menu_category">
                                    //         {categoryLabel}
                                    //     </div>
                                    <>
                                        {/* {Object.keys(ContentJSON)?.filter((data) => getCloudName(data)?.toLowerCase().includes(searchTerm.toLowerCase())).sort((a, b) => getCloudName(a).localeCompare(getCloudName(b), undefined, { sensitivity: "base" })).map((data) => ( */}
                                        {blogPosts?.filter((data) => getCloudName(data?.vendorName)?.toLowerCase().includes(searchTerm.toLowerCase())).sort((a, b) => getCloudName(a?.vendorName).localeCompare(getCloudName(b?.vendorName), undefined, { sensitivity: "base" })).map((data) => (
                                            <Link
                                                to={window.location.host?.includes("blogs") ? `/${data?.customPath ? data?.customPath : data?.vendorName}` : `/blog/post/${data?.customPath ? data?.customPath : data?.vendorName}`}
                                                key={data?.vendorName}
                                                className={`cf_blog_post_blog_menu_item_link ${(postId || "ACTIVECAMPAIGN") === `${data?.customPath ? data?.customPath : data?.vendorName}` ? "cf_blog_post_blog_menu_item_link_active" : ""}`}
                                            >
                                                <div className="cf_blog_post_blog_menu_item">
                                                    <span className="cf_blog_post_blog_menu_item_icon">
                                                        <img
                                                            src={cloudImageMapper(data?.vendorName)}
                                                            alt=""
                                                            onError={(e) => { e.target.style.display = "none"; }}
                                                        />
                                                    </span>
                                                    <span className="cf_blog_post_blog_menu_item_label">
                                                        {getCloudName(data?.vendorName)}
                                                    </span>
                                                </div>
                                            </Link>
                                        ))}
                                    </>
                                    // </div>
                                ))}
                            </div>
                        </div>
                        <div className="cf_blog_post_content_container" ref={printContentRef}>
                            <div className="cf_blog_poster">
                                <div className="cf_blog_poster_header">
                                    <div className="cf_blog_poster_icon_circle">
                                        <img src={cloudImageMapper(blogContent?.vendorName ?? "ACTIVECAMPAIGN")} alt="" />
                                    </div>
                                    <div className="cf_blog_poster_header_content">
                                        <h2 className="cf_blog_poster_title">{getCloudName(blogContent?.vendorName) ?? "ACTIVECAMPAIGN"} Integration Guide</h2>
                                    </div>
                                    <ActionButton
                                        customClass="changeButtonColorOnHover cf_hide_in_pdf"
                                        customStyles={{
                                            backgroundColor: "#f2f2f2",
                                            padding: "8px 12px",
                                            height: "40px",
                                        }}
                                        buttonType="button"
                                        buttonClickAction={() => {
                                            downloadPDF()
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "5px",
                                            }}
                                        >
                                            <Download size={18} />
                                        </div>
                                    </ActionButton>
                                </div>
                                {/* <BlogPostContentEditor /> */}
                                <div
                                    ref={posterContentRef}
                                    className="cf_blog_poster_content"
                                    dangerouslySetInnerHTML={{
                                        __html: blogContent?.blogContent ?? ContentJSON["ACTIVECAMPAIGN"]
                                    }}
                                ></div>
                            </div>
                        </div>
                    </div>
                </div>
                <BlogFooter />
            </div>
            {
                isLoading ? getCFLoader() : ""
            }
        </>
    );
};

export default BlogPost;